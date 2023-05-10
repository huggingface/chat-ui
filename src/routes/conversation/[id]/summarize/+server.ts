import { buildPrompt } from "$lib/buildPrompt";
import { PUBLIC_SEP_TOKEN } from "$lib/constants/publicSepToken";
import { authCondition } from "$lib/server/auth";
import { collections } from "$lib/server/database";
import { modelEndpoint } from "$lib/server/modelEndpoint";
import { defaultModel } from "$lib/server/models";
import { trimPrefix } from "$lib/utils/trimPrefix";
import { trimSuffix } from "$lib/utils/trimSuffix";
import { textGeneration } from "@huggingface/inference";
import { error } from "@sveltejs/kit";
import { ObjectId } from "mongodb";

export async function POST({ params, locals, fetch }) {
	const convId = new ObjectId(params.id);

	const conversation = await collections.conversations.findOne({
		_id: convId,
		...authCondition(locals),
	});

	if (!conversation) {
		throw error(404, "Conversation not found");
	}

	const firstMessage = conversation.messages.find((m) => m.from === "user");

	const userPrompt =
		`Please summarize the following message as a single sentence of less than 5 words:\n` +
		firstMessage?.content;

	const prompt = buildPrompt([{ from: "user", content: userPrompt }], defaultModel);

	const parameters = {
		...defaultModel.parameters,
		return_full_text: false,
	};

	const endpoint = modelEndpoint(defaultModel);
	let { generated_text } = await textGeneration(
		{
			model: endpoint.url,
			inputs: prompt,
			parameters,
		},
		{
			fetch: (url, options) =>
				fetch(url, {
					...options,
					headers: { ...options?.headers, Authorization: endpoint.authorization },
				}),
		}
	);

	generated_text = trimSuffix(trimPrefix(generated_text, "<|startoftext|>"), PUBLIC_SEP_TOKEN);

	if (generated_text) {
		await collections.conversations.updateOne(
			{
				_id: convId,
				...authCondition(locals),
			},
			{
				$set: { title: generated_text },
			}
		);
	}

	return new Response(
		JSON.stringify(
			generated_text
				? {
						title: generated_text,
				  }
				: {}
		),
		{ headers: { "Content-Type": "application/json" } }
	);
}
