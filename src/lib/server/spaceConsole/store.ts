import { MongoBulkWriteError, type ObjectId } from "mongodb";
import { collections } from "$lib/server/database";
import type { SpaceConsoleEntry, SpaceFrameState } from "$lib/types/SpaceConsole";
import { SPACE_CONSOLE_TTL_SECONDS } from "./indexes";

/** entries kept per conversation and space, older ones are evicted on write */
export const SPACE_CONSOLE_KEEP = 100;
export const CONSOLE_TEXT_MAX = 4096;

export interface IncomingConsoleEntry {
	sessionId: string;
	seq: number;
	ts: number;
	level: string;
	text: string;
	stack?: string;
}

const DUPLICATE_KEY = 11000;

/** ignores a session and seq already stored, then evicts past the cap */
export async function recordConsoleEntries(
	conversationId: ObjectId,
	spaceId: string,
	entries: IncomingConsoleEntry[]
): Promise<number> {
	if (!entries.length) return 0;
	const createdAt = new Date();
	let inserted = 0;
	try {
		const result = await collections.spaceConsoleEntries.insertMany(
			entries.map((entry) => ({
				conversationId,
				spaceId,
				sessionId: entry.sessionId,
				seq: entry.seq,
				ts: entry.ts,
				level: entry.level,
				text: entry.text,
				...(entry.stack ? { stack: entry.stack } : {}),
				createdAt,
			})) as SpaceConsoleEntry[],
			{ ordered: false }
		);
		inserted = result.insertedCount;
	} catch (err) {
		if (
			!(err instanceof MongoBulkWriteError) ||
			(Array.isArray(err.writeErrors) ? err.writeErrors : [err.writeErrors]).some(
				(e) => e.code !== DUPLICATE_KEY
			)
		) {
			throw err;
		}
		inserted = err.insertedCount;
	}
	if (inserted) {
		const stale = await collections.spaceConsoleEntries
			.find({ conversationId, spaceId }, { projection: { _id: 1 } })
			.sort({ _id: -1 })
			.skip(SPACE_CONSOLE_KEEP)
			.toArray();
		if (stale.length) {
			await collections.spaceConsoleEntries.deleteMany({ _id: { $in: stale.map((d) => d._id) } });
		}
	}
	return inserted;
}

export async function recordFrameState(params: {
	conversationId: ObjectId;
	spaceId: string;
	loadId: string;
	state: SpaceFrameState;
	checkId?: string;
	sessionId?: string;
	gradioVersion?: string;
}): Promise<void> {
	const { conversationId, spaceId, loadId, state, checkId, sessionId, gradioVersion } = params;
	const updatedAt = new Date();
	if (state === "loading") {
		await collections.spaceConsoleFrames.updateOne(
			{ conversationId, spaceId },
			{
				$set: { loadId, state, updatedAt, ...(checkId ? { checkId } : {}) },
				$unset: { sessionId: "", gradioVersion: "", ...(checkId ? {} : { checkId: "" }) },
			},
			{ upsert: true }
		);
		return;
	}
	await collections.spaceConsoleFrames.updateOne(
		{ conversationId, spaceId, loadId },
		{
			$set: {
				state,
				updatedAt,
				...(sessionId ? { sessionId } : {}),
				...(gradioVersion !== undefined ? { gradioVersion } : {}),
			},
		}
	);
}

/** the ttl monitor runs once a minute, so reads drop expired rows themselves */
const fresh = () => ({ $gt: new Date(Date.now() - SPACE_CONSOLE_TTL_SECONDS * 1000) });

export function readFrame(conversationId: ObjectId, spaceId: string) {
	return collections.spaceConsoleFrames.findOne({ conversationId, spaceId, updatedAt: fresh() });
}

/** oldest first */
export function readConsoleEntries(conversationId: ObjectId, spaceId: string) {
	return collections.spaceConsoleEntries
		.find({ conversationId, spaceId, createdAt: fresh() })
		.sort({ _id: 1 })
		.toArray();
}
