import {
	PARQUET_EXPORT_DATASET,
	PARQUET_EXPORT_HF_TOKEN,
	PARQUET_EXPORT_SECRET,
} from "$env/static/private";
import { collections } from "$lib/server/database";
import type { Message } from "$lib/types/Message";
import { error } from "@sveltejs/kit";
import { pathToFileURL } from "node:url";
import { unlink } from "node:fs/promises";
import { uploadFile } from "@huggingface/hub";
import parquet from "parquetjs";
import { z } from "zod";

// Triger like this:
// curl -X POST "http://localhost:5173/chat/admin/export" -H "Authorization: Bearer <PARQUET_EXPORT_SECRET>" -H "Content-Type: application/json" -d '{"model": "OpenAssistant/oasst-sft-6-llama-30b-xor"}'

export async function POST({ request }) {
	if (!PARQUET_EXPORT_SECRET || !PARQUET_EXPORT_DATASET || !PARQUET_EXPORT_HF_TOKEN) {
		throw error(500, "Parquet export is not configured.");
	}

	if (request.headers.get("Authorization") !== `Bearer ${PARQUET_EXPORT_SECRET}`) {
		throw error(403);
	}

	const { model } = z
		.object({
			model: z.string(),
		})
		.parse(await request.json());

	const schema = new parquet.ParquetSchema({
		title: { type: "UTF8" },
		created_at: { type: "TIMESTAMP_MILLIS" },
		updated_at: { type: "TIMESTAMP_MILLIS" },
		messages: {
			repeated: true,
			fields: {
				from: { type: "UTF8" },
				content: { type: "UTF8" },
				score: { type: "INT_8", optional: true },
			},
		},
	});

	const fileName = `/tmp/conversations-${new Date().toJSON().slice(0, 10)}-${Date.now()}.parquet`;

	const writer = await parquet.ParquetWriter.openFile(schema, fileName);

	let count = 0;
	console.log("Exporting conversations for model", model);

	for await (const conversation of collections.settings.aggregate<{
		title: string;
		created_at: Date;
		updated_at: Date;
		messages: Message[];
	}>([
		{
			$match: {
				shareConversationsWithModelAuthors: true,
				sessionId: { $exists: true },
				userId: { $exists: false },
			},
		},
		{
			$lookup: {
				from: "conversations",
				localField: "sessionId",
				foreignField: "sessionId",
				as: "conversations",
				pipeline: [{ $match: { model, userId: { $exists: false } } }],
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
				content: message.content,
				...(message.score ? { score: message.score } : undefined),
			})),
		});
		++count;

		if (count % 1_000 === 0) {
			console.log("Exported", count, "conversations");
		}
	}

	console.log("exporting convos with userId");

	for await (const conversation of collections.settings.aggregate<{
		title: string;
		created_at: Date;
		updated_at: Date;
		messages: Message[];
	}>([
		{ $match: { shareConversationsWithModelAuthors: true, userId: { $exists: true } } },
		{
			$lookup: {
				from: "conversations",
				localField: "userId",
				foreignField: "userId",
				as: "conversations",
				pipeline: [{ $match: { model } }],
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
				content: message.content,
				...(message.score ? { score: message.score } : undefined),
			})),
		});
		++count;

		if (count % 1_000 === 0) {
			console.log("Exported", count, "conversations");
		}
	}

	await writer.close();

	console.log("Uploading", fileName, "to Hugging Face Hub");

	await uploadFile({
		file: pathToFileURL(fileName) as URL,
		credentials: { accessToken: PARQUET_EXPORT_HF_TOKEN },
		repo: {
			type: "dataset",
			name: PARQUET_EXPORT_DATASET,
		},
	});

	console.log("Upload done");

	await unlink(fileName);

	return new Response();
}
