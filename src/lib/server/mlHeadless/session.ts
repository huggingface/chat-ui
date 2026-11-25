import type { ObjectId } from "mongodb";

const PREFIX = "ml-headless:";

/**
 * Stored on a headless run's conversation and on everything it parks, so a resume without a
 * request can tell the run apart from the same account's own chats.
 */
export function headlessSessionId(userId: ObjectId): string {
	return `${PREFIX}${userId.toHexString()}`;
}

export function isHeadlessSession(sessionId: string | undefined): boolean {
	return !!sessionId?.startsWith(PREFIX);
}
