import { createHash, randomUUID } from "node:crypto";
import { MongoServerError, ObjectId } from "mongodb";
import { collections } from "$lib/server/database";
import type { SlackInput, SlackThread } from "./types";
import { threadKey } from "./context";

export const inputKey = (team: string, event: string) =>
	createHash("sha256").update(`${team}:${event}`).digest("hex");
const duplicate = (err: unknown) => err instanceof MongoServerError && err.code === 11000;

export async function getOrCreateThread(
	teamId: string,
	channel: string,
	threadTs: string,
	owner: string,
	hfUserId?: ObjectId,
	ownerTeamId?: string
): Promise<SlackThread> {
	const _id = threadKey(teamId, channel, threadTs);
	const now = new Date();
	const row: SlackThread = {
		_id,
		teamId,
		channel,
		threadTs,
		owner,
		...(hfUserId ? { hfUserId, ownerTeamId: ownerTeamId ?? teamId } : {}),
		conversationId: new ObjectId(),
		watching: true,
		createdAt: now,
		updatedAt: now,
	};
	try {
		await collections.slackThreads.updateOne({ _id }, { $setOnInsert: row }, { upsert: true });
	} catch (err) {
		if (!duplicate(err)) throw err;
	}
	const stored = await collections.slackThreads.findOne({ _id });
	if (!stored) throw new Error("Could not create Slack thread.");
	return stored;
}

export async function enqueueInput(
	input: Pick<
		SlackInput,
		| "_id"
		| "threadId"
		| "user"
		| "text"
		| "ts"
		| "retry"
		| "resumeElicitationId"
		| "expectedMessageId"
		| "expectedGenerationId"
	>
): Promise<boolean> {
	const now = new Date();
	let inserted = false;
	if (input.retry) {
		const retried = await collections.slackInputs.updateOne(
			{ _id: input._id, threadId: input.threadId, status: "failed" },
			{
				$set: { status: "queued", updatedAt: now },
				$unset: { error: "", failureNotified: "" },
			}
		);
		inserted = retried.modifiedCount === 1;
	}
	try {
		const result = await collections.slackInputs.updateOne(
			{ _id: input._id },
			{ $setOnInsert: { ...input, status: "queued", createdAt: now, updatedAt: now } },
			{ upsert: true }
		);
		inserted ||= result.upsertedCount === 1;
	} catch (err) {
		if (!duplicate(err)) throw err;
	}
	await collections.slackThreads.updateOne(
		{ _id: input.threadId },
		{ $set: { watching: true, updatedAt: now, renderFailures: 0, nextRenderAt: now } }
	);
	return inserted;
}

/** One Socket Mode consumer/worker per workspace, even during rolling deployments. */
export class SlackLeader {
	readonly owner = randomUUID();
	private validUntil = 0;
	isValid() {
		return Date.now() < this.validUntil;
	}
	constructor(readonly teamId: string) {}
	async acquire(): Promise<boolean> {
		const now = new Date();
		try {
			const result = await collections.slackLeases.findOneAndUpdate(
				{ _id: this.teamId, $or: [{ owner: this.owner }, { until: { $lt: now } }] },
				{ $set: { owner: this.owner, until: new Date(now.getTime() + 60_000) } },
				{ upsert: true, returnDocument: "after" }
			);
			const held = result?.owner === this.owner;
			this.validUntil = held ? now.getTime() + 50000 : 0;
			return held;
		} catch (err) {
			if (duplicate(err)) return false;
			throw err;
		}
	}
	async release(): Promise<void> {
		await collections.slackLeases.deleteOne({ _id: this.teamId, owner: this.owner });
	}
}
