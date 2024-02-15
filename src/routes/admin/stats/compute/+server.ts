import { ADMIN_API_SECRET } from "$env/static/private";
import { error, json } from "@sveltejs/kit";
import type { ConversationStats } from "$lib/types/ConversationStats";
import { CONVERSATION_STATS_COLLECTION, collections } from "$lib/server/database.js";

export async function POST({ request }) {
	const authorization = request.headers.get("Authorization");

	if (authorization !== `Bearer ${ADMIN_API_SECRET}`) {
		throw error(401, "Unauthorized");
	}

	computeStats({ dateField: "updatedAt" }).catch(console.error);
	computeStats({ dateField: "createdAt" }).catch(console.error);

	return json({}, { status: 202 });
}

async function computeStats(params: { dateField: ConversationStats["date"]["field"] }) {
	const lastComputed = await collections.conversationStats.findOne(
		{ "date.field": params.dateField },
		{ sort: { "date.day": -1 } }
	);

	const minDay = lastComputed ? lastComputed.date.day : new Date(0);

	console.log("Computing stats for", params.dateField, "from", minDay);

	await collections.conversations
		.aggregate(
			[
				{
					$match: {
						[params.dateField]: { $gte: minDay },
					},
				},
				{
					$project: {
						[params.dateField]: 1,
						sessionId: 1,
						userId: 1,
					},
				},
				{
					$sort: {
						[params.dateField]: 1,
					},
				},
				{
					$facet: {
						userId: [
							{
								$match: {
									userId: { $exists: true },
								},
							},
							{
								$group: {
									_id: {
										day: { $dateTrunc: { date: `$${params.dateField}`, unit: "day" } },
										userId: "$userId",
									},
									count: { $sum: 1 },
								},
							},
							{
								$project: {
									_id: 0,
									date: {
										day: "$_id.day",
										field: params.dateField,
									},
									distinct: "userId",
									count: 1,
								},
							},
						],
						sessionId: [
							{
								$match: {
									sessionId: { $exists: true },
								},
							},
							{
								$group: {
									_id: {
										day: { $dateTrunc: { date: `$${params.dateField}`, unit: "day" } },
										sessionId: "$userId",
									},
									count: { $sum: 1 },
								},
							},
							{
								$project: {
									_id: 0,
									date: {
										day: "$_id.day",
										field: params.dateField,
									},
									distinct: "sessionId",
									count: 1,
								},
							},
						],
						userOrSessionId: [
							{
								$group: {
									_id: {
										day: { $dateTrunc: { date: `$${params.dateField}`, unit: "day" } },
										userOrSessionId: { $ifNull: ["$userId", "$sessionId"] },
									},
									count: { $sum: 1 },
								},
							},
							{
								$project: {
									_id: 0,
									date: {
										day: "$_id.day",
										field: params.dateField,
									},
									distinct: "userOrSessionId",
									count: 1,
								},
							},
						],
						_id: [
							{
								$group: {
									_id: {
										day: { $dateTrunc: { date: `$${params.dateField}`, unit: "day" } },
									},
									count: { $sum: 1 },
								},
							},
							{
								$project: {
									_id: 0,
									date: {
										day: "$_id.day",
										field: params.dateField,
									},
									distinct: "_id",
									count: 1,
								},
							},
						],
					},
				},
				{
					$project: {
						stats: {
							$concatArrays: ["$userId", "$sessionId", "$userOrSessionId", "$_id"],
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
					$merge: {
						into: CONVERSATION_STATS_COLLECTION,
						whenMatched: "replace",
						whenNotMatched: "insert",
					},
				},
			],
			{ allowDiskUse: true }
		)
		.next();

	console.log("Computed stats for", params.dateField);
}
