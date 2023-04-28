import {
	PARQUET_EXPORT_DATASET,
	PARQUET_EXPORT_HF_TOKEN,
	PARQUET_EXPORT_SECRET,
} from "$env/static/private";
import { collections } from "$lib/server/database.js";
import type { Message } from "$lib/types/Message.js";
import { error } from "@sveltejs/kit";
import { pathToFileURL } from "node:url";
import { uploadFile } from "@huggingface/hub";
import parquet from "parquetjs";

export async function POST({ request }) {
	if (request.headers.get("Authorization") !== `Bearer ${PARQUET_EXPORT_SECRET}`) {
		throw error(403);
	}

	const schema = new parquet.ParquetSchema({
		title: { type: "UTF8" },
		created_at: { type: "TIMESTAMP_MILLIS" },
		updated_at: { type: "TIMESTAMP_MILLIS" },
		messages: { repeated: true, fields: { from: { type: "UTF8" }, content: { type: "UTF8" } } },
	});

	const writer = await parquet.ParquetWriter.openFile(schema, "conversations.parquet");

	for await (const conversation of collections.settings.aggregate([
		{ $match: { shareConversationsWithModelAuthors: true } },
		{
			$lookup: {
				from: "conversations",
				localField: "sessionId",
				foreignField: "sessionId",
				as: "conversations",
			},
		},
		{ $unwind: "$conversations" },
		{
			$project: {
				title: "$conversations.title",
				created_at: "$conversations.createdAt",
				updated_at: "$conversations.updatedAt",
				messages: "$conversations.messages",
			},
		},
	])) {
		await writer.appendRow({
			title: conversation.title,
			created_at: conversation.created_at,
			updated_at: conversation.updated_at,
			messages: conversation.messages.map((message: Message) => ({
				from: message.from,
				message: message.content,
			})),
		});
	}

	await writer.close();

	await uploadFile({
		file: pathToFileURL("conversations.parquet"),
		credentials: { accessToken: PARQUET_EXPORT_HF_TOKEN },
		repo: {
			type: "dataset",
			name: PARQUET_EXPORT_DATASET,
		},
	});

	return new Response();
}
