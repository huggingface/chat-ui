import { randomUUID } from "node:crypto";
import { ObjectId } from "mongodb";
import { base } from "$app/paths";
import { collections } from "$lib/server/database";
import { config } from "$lib/server/config";
import { logger } from "$lib/server/logger";
import { models } from "$lib/server/models";
import { resolveMlAssistantModel } from "$lib/server/mlAssistantModels";
import { generateConversationResponse } from "$lib/server/generation/conversationRequest";
import { isTurnAlive, latestTurnGeneration } from "$lib/server/generation/turnLog";
import { stopConversation } from "$lib/server/generation/stopConversation";
import { usdToMicroUsd } from "$lib/utils/mlBudget";
import type { Conversation } from "$lib/types/Conversation";
import type { User } from "$lib/types/User";
import type { HeadlessConfig } from "./config";
import { headlessLocals } from "./identity";
import { headlessSessionId } from "./session";

export type RunStatus = "running" | "waiting" | "asking" | "done" | "failed" | "stopped";

export interface RunView {
	id: string;
	url: string;
	status: RunStatus;
	spentUsd: number;
	budgetUsd: number;
	finalAnswer?: string;
	question?: string;
	waitReason?: string;
	error?: string;
}

export class HeadlessRunError extends Error {}

function runUrl(id: ObjectId): string {
	return `${config.PUBLIC_ORIGIN || ""}${base}/conversation/${id.toHexString()}`;
}

function visibleText(text: string): string {
	return text.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, "").trim();
}

/**
 * Create an ML Intern conversation for the headless identity and start its first turn.
 * Returns once the harness has accepted the turn; the turn itself keeps running in this
 * process, and parks and resumes through the sweepers.
 */
export async function startRun(
	user: User,
	settings: HeadlessConfig,
	input: { prompt: string; budgetUsd: number; title?: string }
): Promise<ObjectId> {
	const model = resolveMlAssistantModel(undefined);
	if (!model || !models.some((m) => m.id === model))
		throw new HeadlessRunError("No ML Intern model is configured.");
	if (input.budgetUsd > settings.maxBudgetUsd)
		throw new HeadlessRunError(
			`budgetUsd exceeds this server's cap of $${settings.maxBudgetUsd} per run.`
		);

	const locals = await headlessLocals(user);
	const now = new Date();
	const root = {
		id: randomUUID(),
		from: "system" as const,
		content: "",
		children: [],
		ancestors: [],
		createdAt: now,
		updatedAt: now,
	};
	const conversation: Conversation = {
		_id: new ObjectId(),
		userId: user._id,
		sessionId: headlessSessionId(user._id),
		model,
		title: input.title?.trim() || "ML Intern run",
		preprompt: "",
		mlAssistant: true,
		rootMessageId: root.id,
		messages: [root],
		createdAt: now,
		updatedAt: now,
		mlBudget: {
			totalMicroUsd: usdToMicroUsd(input.budgetUsd),
			spentMicroUsd: 0,
			reservations: [],
		},
	};
	await collections.conversations.insertOne(conversation);

	const data = new FormData();
	data.set(
		"data",
		JSON.stringify({ inputs: input.prompt, id: root.id, generationId: randomUUID() })
	);
	let response: Response;
	try {
		response = await generateConversationResponse({
			request: new Request("http://headless.internal/conversation", { method: "POST", body: data }),
			locals,
			params: { id: conversation._id.toHexString() },
			getClientAddress: () => "ml-headless",
		});
	} catch (err) {
		await collections.conversations.deleteOne({ _id: conversation._id });
		throw err;
	}
	if (!response.ok) {
		await collections.conversations.deleteOne({ _id: conversation._id });
		throw new HeadlessRunError(`ML Intern rejected the run (${response.status}).`);
	}

	// Persistence, waits and questions live in the shared runner. Draining the stream only
	// keeps the producer from stalling on backpressure.
	void drain(response, conversation._id);
	return conversation._id;
}

async function drain(response: Response, id: ObjectId): Promise<void> {
	const reader = response.body?.getReader();
	if (!reader) return;
	try {
		while (!(await reader.read()).done) {
			/* State is persisted by the shared runner. */
		}
	} catch (err) {
		logger.error({ err, conversationId: id.toHexString() }, "[ml-headless] run stream failed");
	} finally {
		reader.releaseLock();
	}
}

export async function findRun(user: User, id: string): Promise<Conversation | null> {
	if (!ObjectId.isValid(id)) return null;
	return collections.conversations.findOne({
		_id: new ObjectId(id),
		userId: user._id,
		sessionId: headlessSessionId(user._id),
	});
}

/** The run's state, derived from the same records the UI and Slack bot read. */
export async function readRun(conv: Conversation): Promise<RunView> {
	const view: RunView = {
		id: conv._id.toHexString(),
		url: runUrl(conv._id),
		status: "running",
		spentUsd: (conv.mlBudget?.spentMicroUsd ?? 0) / 1_000_000,
		budgetUsd: (conv.mlBudget?.totalMicroUsd ?? 0) / 1_000_000,
	};
	const message = conv.messages[conv.messages.length - 1];
	// The assistant message appears a moment after the turn is accepted.
	if (message?.from !== "assistant") return view;

	const question = await collections.mcpElicitations.findOne({
		conversationId: conv._id,
		status: "pending",
		$or: [{ "pending.messageId": message.id }, { generationId: message.generationId }],
	});
	if (question) {
		return {
			...view,
			status: "asking",
			question: question.request.message || "ML Intern is waiting for input.",
		};
	}

	const state = await collections.turnStates.findOne({
		conversationId: conv._id,
		messageId: message.id,
	});
	const live = await isTurnAlive(conv._id, message.id);
	if (live.alive) {
		return state?.status === "waiting"
			? { ...view, status: "waiting", waitReason: state.waitReason }
			: view;
	}
	// Terminal only once the turn record says so. Between the assistant message appearing and
	// the producer registering there is neither a live generation nor a state record yet:
	// that is a run starting, not one that finished.
	if (!state || state.status === "running") {
		return live.status === "gone"
			? view
			: { ...view, status: "failed", error: "The run stopped unexpectedly." };
	}
	if (state.status === "failed") {
		return {
			...view,
			status: message.interrupted ? "stopped" : "failed",
			error: state.error ?? "The run failed.",
		};
	}
	if (message.interrupted) return { ...view, status: "stopped" };
	return { ...view, status: "done", finalAnswer: visibleText(message.content) };
}

/**
 * A producer told to stop can still park a wait or a question on its way out. The cleanup
 * below waits for it to end, or it would miss that park and leave the run parked for good.
 */
async function producerEnded(conv: Conversation): Promise<void> {
	const message = conv.messages[conv.messages.length - 1];
	if (message?.from !== "assistant") return;
	const deadline = Date.now() + 5_000;
	while (Date.now() < deadline) {
		const newest = await latestTurnGeneration(conv._id, message.id);
		if (newest?.status !== "running") return;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
}

/**
 * Stop the live producer and cancel durable waits and pending questions, so a restarted
 * sweeper cannot wake the run. Remote compute is left running and tracked, as with the
 * UI's stop button. Same steps as the Slack bot's stop.
 */
export async function stopRun(user: User, conv: Conversation): Promise<void> {
	const reason = "Stopped through the API";
	await stopConversation({
		params: { id: conv._id.toHexString() },
		locals: { user, sessionId: headlessSessionId(user._id), isAdmin: false },
		request: new Request("http://headless.internal/stop", { method: "POST" }),
	});
	await producerEnded(conv);
	const now = new Date();
	await collections.parkedCalls.updateMany(
		{ conversationId: conv._id, status: "waiting" },
		{ $set: { status: "abandoned", abandonedReason: reason, updatedAt: now } }
	);
	await collections.mcpElicitations.updateMany(
		{ conversationId: conv._id, status: "pending" },
		{
			$set: {
				status: "resolved",
				action: "cancel",
				resolution: "aborted",
				resolvedAt: now,
				updatedAt: now,
				resume: { status: "abandoned", takenAt: now, attempts: 0, abandonedReason: reason },
			},
		}
	);
	const parked = await collections.turnStates.findOneAndUpdate(
		{ conversationId: conv._id, status: { $in: ["waiting", "awaiting_input"] } },
		{ $set: { status: "failed", error: reason, endedAt: now, updatedAt: now } },
		{ returnDocument: "after" }
	);
	if (!parked) return;
	// No producer was running to consume the stop marker, and a leftover one would abort
	// whatever starts next in this conversation.
	await collections.abortedGenerations.deleteOne({
		conversationId: conv._id,
		updatedAt: { $lte: now },
	});
	await collections.conversations.updateOne(
		{ _id: conv._id, "messages.id": parked.messageId },
		{ $set: { "messages.$.interrupted": true, updatedAt: now } }
	);
}
