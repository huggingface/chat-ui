import { ADMIN_API_SECRET } from "$env/static/private";
import { error, json } from "@sveltejs/kit";
import type { ConversationStats } from "$lib/types/ConversationStats";
import { CONVERSATION_STATS_COLLECTION, collections } from "$lib/server/database.js";

export async function POST({ request }) {
	const authorization = request.headers.get("Authorization");

	if (authorization !== `Bearer ${ADMIN_API_SECRET}`) {
		throw error(401, "Unauthorized");
	}

	computeStats({ dateField: "updatedAt", type: "conversation" }).catch(console.error);
	computeStats({ dateField: "createdAt", type: "conversation" }).catch(console.error);
	computeStats({ dateField: "createdAt", type: "message" }).catch(console.error);

	return json({}, { status: 202 });
}

async function computeStats(params: {
	dateField: ConversationStats["date"]["field"];
	type: ConversationStats["type"];
}) {
	// Recompute 1~2 months of stats
	const lastComputed = await collections.conversationStats.findOne(
		{ "date.field": params.dateField, "date.span": "month", type: params.type },
		{ sort: { "date.at": -1 } }
	);

	const minDay = lastComputed ? lastComputed.date.at : new Date(0);

	console.log("Computing stats for", params.type, params.dateField, "from", minDay);

	const dateField = params.type === "message" ? "messages." + params.dateField : params.dateField;

	await collections.conversations
		.aggregate(
			[
				{
					$match: {
						[dateField]: { $gte: minDay, $lte: new Date("2023-05-02") },
					},
				},
				{
					$project: {
						[dateField]: 1,
						sessionId: 1,
						userId: 1,
					},
				},
				{
					$sort: {
						[dateField]: 1,
					},
				},
				{
					$facet: Object.fromEntries(
						["day", "week", "month"].flatMap((span) => [
							[
								`${span}_userId`,
								[
									{
										$match: {
											userId: { $exists: true },
										},
									},
									{
										$group: {
											_id: {
												at: { $dateTrunc: { date: `$${dateField}`, unit: span } },
												userId: "$userId",
											},
										},
									},
									{
										$group: {
											_id: "$_id.at",
											count: { $sum: 1 },
										},
									},
									{
										$project: {
											_id: 0,
											date: {
												at: "$_id",
												field: dateField,
												span,
											},
											distinct: "userId",
											count: 1,
										},
									},
								],
							],
							[
								`${span}_sessionId`,
								[
									{
										$match: {
											sessionId: { $exists: true },
										},
									},
									{
										$group: {
											_id: {
												at: { $dateTrunc: { date: `$${dateField}`, unit: span } },
												sessionId: "$sessionId",
											},
										},
									},
									{
										$group: {
											_id: "$_id.at",
											count: { $sum: 1 },
										},
									},
									{
										$project: {
											_id: 0,
											date: {
												at: "$_id",
												field: dateField,
												span,
											},
											distinct: "sessionId",
											count: 1,
										},
									},
								],
							],
							[
								`${span}_userOrSessionId`,
								[
									{
										$group: {
											_id: {
												at: { $dateTrunc: { date: `$${dateField}`, unit: span } },
												userOrSessionId: { $ifNull: ["$userId", "$sessionId"] },
											},
										},
									},
									{
										$group: {
											_id: "$_id.at",
											count: { $sum: 1 },
										},
									},
									{
										$project: {
											_id: 0,
											date: {
												at: "$_id",
												field: dateField,
												span,
											},
											distinct: "userOrSessionId",
											count: 1,
										},
									},
								],
							],
							[
								`${span}_id`,
								[
									{
										$group: {
											_id: { $dateTrunc: { date: `$${dateField}`, unit: span } },
											count: { $sum: 1 },
										},
									},
									{
										$project: {
											_id: 0,
											date: {
												at: "$_id",
												field: dateField,
												span,
											},
											distinct: "_id",
											count: 1,
										},
									},
								],
							],
						])
					),
				},
				{
					$project: {
						stats: {
							$concatArrays: [
								"$day_userId",
								"$day_sessionId",
								"$day_userOrSessionId",
								"$day_id",
								"$week_userId",
								"$week_sessionId",
								"$week_userOrSessionId",
								"$week_id",
								"$month_userId",
								"$month_sessionId",
								"$month_userOrSessionId",
								"$month_id",
							],
						},
					},
				},
				{
					$unwind: "$stats",
				},
				{
					$replaceRoot: {
						newRoot: "$stats",
					},
				},
				{
					$set: {
						type: params.type,
					},
				},
				{
					$merge: {
						into: CONVERSATION_STATS_COLLECTION,
						on: ["date.at", "type", "date.span", "date.field", "distinct"],
						whenMatched: "replace",
						whenNotMatched: "insert",
					},
				},
			],
			{ allowDiskUse: true }
		)
		.next();

	console.log("Computed stats for", params.type, params.dateField);
}
