import { ObjectId } from "mongodb";
import { collections } from "$lib/server/database";

import { answerSideQuestion as answer, SideQuestionError } from "$lib/server/mlSideQuestion";
import { owns } from "./owner";
import type { RunRef } from "./types";

export { SIDE_QUESTION_MAX_CHARS } from "$lib/server/mlSideQuestion";

export async function* answerSideQuestion({
	run,
	...opts
}: Omit<Parameters<typeof answer>[0], "conversationId"> & { run: RunRef }): AsyncGenerator<
	string,
	void,
	void
> {
	if (!(await owns(run))) throw new SideQuestionError("not_found", "Conversation not found");
	yield* answer({ ...opts, conversationId: run.conversationId });
}

/** rows go in before counting, so racing requests may both back off but never both take the last slot */
export async function reserveSideQuestionQuota(
	quotas: Array<{ key: string; perMinute: number }>
): Promise<boolean> {
	const now = new Date();
	const expiresAt = new Date(now.getTime() + 60_000);
	const rows = quotas.map((quota) => ({ ...quota, _id: new ObjectId() }));
	await collections.messageEvents.insertMany(
		rows.map(({ _id, key }) => ({ _id, type: "message", userId: key, createdAt: now, expiresAt }))
	);
	const counts = await Promise.all(
		rows.map(({ key }) =>
			collections.messageEvents.countDocuments({
				userId: key,
				type: "message",
				expiresAt: { $gt: now },
			})
		)
	);
	if (rows.every((row, i) => counts[i] <= row.perMinute)) return true;
	await collections.messageEvents.deleteMany({ _id: { $in: rows.map((row) => row._id) } });
	return false;
}
