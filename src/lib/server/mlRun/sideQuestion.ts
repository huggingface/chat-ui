import { ObjectId } from "mongodb";
import { collections } from "$lib/server/database";

export { answerSideQuestion, SIDE_QUESTION_MAX_CHARS } from "$lib/server/mlSideQuestion";

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
