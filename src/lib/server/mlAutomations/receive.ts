import { timingSafeEqual } from "node:crypto";
import { ObjectId, MongoServerError } from "mongodb";
import { collections } from "$lib/server/database";
import { logger } from "$lib/server/logger";
import { openRunSession, sendTurn } from "$lib/server/mlRun";
import type { MlAutomation, MlAutomationDelivery } from "$lib/types/MlAutomation";
import type { User } from "$lib/types/User";
import { automationLocals, AutomationIdentityError, automationSessionId } from "./identity";
import { automationPrompt, isRepoEvent, parseHubEvent, repoWebUrl, type HubEvent } from "./event";
import { hashSecret } from "./store";

export interface DeliveryResult {
	status: number;
	message: string;
	conversationId?: ObjectId;
	/** settles once the first turn ends or parks */
	run?: Promise<void>;
}

const DAY_MS = 86_400_000;

function secretMatches(automation: MlAutomation, secret: string | null): boolean {
	if (!secret) return false;
	const given = Buffer.from(hashSecret(secret), "hex");
	const stored = Buffer.from(automation.secretHash, "hex");
	return given.length === stored.length && timingSafeEqual(given, stored);
}

/** the hub retries anything but a 2xx and suspends a webhook that keeps failing */
export async function receiveDelivery(opts: {
	automationId: string;
	secret: string | null;
	deliveryId: string | null;
	body: unknown;
}): Promise<DeliveryResult> {
	const automation = ObjectId.isValid(opts.automationId)
		? await collections.mlAutomations.findOne({ _id: new ObjectId(opts.automationId) })
		: null;
	if (!automation) return { status: 404, message: "Unknown automation." };
	if (!secretMatches(automation, opts.secret)) return { status: 401, message: "Wrong secret." };
	if (!opts.deliveryId) return { status: 400, message: "Missing Webhook-Id." };
	if (!automation.enabled) return { status: 200, message: "Automation is turned off." };
	const event = parseHubEvent(opts.body);
	if (!event) return { status: 200, message: "Not an event this automation handles." };

	const delivery: MlAutomationDelivery = {
		_id: `${automation._id.toHexString()}:${opts.deliveryId}`,
		automationId: automation._id,
		userId: automation.userId,
		receivedAt: new Date(),
		status: "started",
		event: { action: event.event.action, scope: event.event.scope, repo: event.repo.name },
	};
	const skip = await skipReason(automation, event);
	if (skip) Object.assign(delivery, { status: "skipped", reason: skip });
	try {
		await collections.mlAutomationDeliveries.insertOne(delivery);
	} catch (err) {
		if (err instanceof MongoServerError && err.code === 11000)
			return { status: 200, message: "Already received." };
		throw err;
	}
	if (skip) return { status: 200, message: skip };
	return startRun(automation, delivery, event);
}

async function skipReason(automation: MlAutomation, event: HubEvent): Promise<string | undefined> {
	if (!isRepoEvent(event)) return "Only repo events start runs.";
	const started = await collections.mlAutomationDeliveries
		.find(
			{
				automationId: automation._id,
				status: "started",
				receivedAt: { $gt: new Date(Date.now() - DAY_MS) },
			},
			{ projection: { conversationId: 1 } }
		)
		.sort({ receivedAt: -1 })
		.toArray();
	if (started.length >= automation.maxRunsPerDay) return "Daily run limit reached.";
	// a run that pushes to a watched repo would otherwise start itself again
	const conversationIds = started.flatMap((row) =>
		row.conversationId ? [row.conversationId] : []
	);
	const busy =
		conversationIds.length > 0 &&
		(await collections.turnStates.findOne(
			{
				conversationId: { $in: conversationIds },
				status: { $in: ["running", "waiting", "awaiting_input"] },
			},
			{ projection: { _id: 1 } }
		));
	return busy ? "A run from this automation is still going." : undefined;
}

async function startRun(
	automation: MlAutomation,
	delivery: MlAutomationDelivery,
	event: HubEvent
): Promise<DeliveryResult> {
	const fail = async (reason: string) => {
		await collections.mlAutomationDeliveries.updateOne(
			{ _id: delivery._id },
			{ $set: { status: "failed", reason } }
		);
	};
	let locals: App.Locals & { user: User };
	try {
		const user = await collections.users.findOne({ _id: automation.userId });
		if (!user) throw new AutomationIdentityError("This automation's owner no longer exists.");
		locals = automationLocals(automation, user);
	} catch (err) {
		if (!(err instanceof AutomationIdentityError)) throw err;
		await fail(err.message);
		await collections.mlAutomations.updateOne(
			{ _id: automation._id },
			{ $set: { enabled: false, disabledReason: err.message, updatedAt: new Date() } }
		);
		return { status: 200, message: err.message };
	}
	const { user } = locals;

	const conversationId = new ObjectId();
	try {
		await openRunSession({
			conversationId,
			user,
			sessionId: automationSessionId(automation._id),
			managedBy: { kind: "automation", continueUrl: repoWebUrl(event.repo) },
			title: `${automation.name}: ${event.repo.name}`,
			budgetUsd: automation.budgetUsd,
			headless: true,
			automationId: automation._id,
			...(automation.billTo ? { billTo: automation.billTo } : {}),
		});
	} catch (err) {
		// a retry would hit the same configuration, so the hub is told it arrived
		const reason = err instanceof Error ? err.message : String(err);
		await fail(reason);
		return { status: 200, message: reason };
	}
	await collections.mlAutomationDeliveries.updateOne(
		{ _id: delivery._id },
		{ $set: { conversationId } }
	);

	const run = sendTurn({
		conversationId,
		locals,
		client: "automation",
		input: { text: automationPrompt(automation.instruction, event) },
		personalTools: false,
	}).catch(async (err) => {
		logger.error(
			{
				err,
				automationId: automation._id.toHexString(),
				conversationId: conversationId.toHexString(),
			},
			"[ml automations] run failed"
		);
		await fail(err instanceof Error ? err.message : String(err)).catch(() => {});
	});
	return { status: 202, message: "Run started.", conversationId, run };
}
