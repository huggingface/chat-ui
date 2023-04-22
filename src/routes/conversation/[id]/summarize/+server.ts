import { HF_TOKEN } from "$env/static/private";
import { PUBLIC_MODEL_ENDPOINT } from "$env/static/public";
import { buildPrompt } from "$lib/buildPrompt";
import { collections } from "$lib/server/database.js";
import { error } from "@sveltejs/kit";
import { ObjectId } from "mongodb";

export async function POST({ params, locals, fetch }) {
	const convId = new ObjectId(params.id);

	const conversation = await collections.conversations.findOne({
		_id: convId,
		sessionId: locals.sessionId,
	});

	if (!conversation) {
		throw error(404, "Conversation not found");
	}

	const firstMessage = conversation.messages.find((m) => m.from === "user");

	const userPrompt =
		`You are a summarizing assistant. Please summarize the following message as a single sentence of less than 5 words:\n` +
		firstMessage?.content;

	const prompt = buildPrompt([{ from: "user", content: userPrompt }]);

	const resp = await fetch(PUBLIC_MODEL_ENDPOINT, {
		headers: {
			"Content-Type": "application/json",
			Authorization: `Basic ${HF_TOKEN}`,
		},
		method: "POST",
		body: JSON.stringify({
			inputs: prompt,
			parameters: {
				temperature: 0.9,
				top_p: 0.95,
				repetition_penalty: 1.2,
				top_k: 50,
				watermark: false,
				max_new_tokens: 1024,
				stop: ["<|endoftext|>"],
				return_full_text: false,
			},
		}),
	});

	const response = await resp.json();
	let generatedTitle: string | undefined;
	try {
		if (typeof response[0].generated_text === "string") {
			generatedTitle = response[0].generated_text;
		}
	} catch {
		console.error("summarization failed");
	}

	if (generatedTitle) {
		await collections.conversations.updateOne(
			{
				_id: convId,
				sessionId: locals.sessionId,
			},
			{
				$set: { title: generatedTitle },
			}
		);
	}

	return new Response(
		JSON.stringify(
			generatedTitle
				? {
						title: generatedTitle,
				  }
				: {}
		),
		{ headers: { "Content-Type": "application/json" } }
	);
}
