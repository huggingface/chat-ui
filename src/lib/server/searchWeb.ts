import { SERPAPI_KEY } from "$env/static/private";
import type { Message } from "$lib/types/Message";

import { getJson } from "serpapi";
import type { GoogleParameters } from "serpapi";
import { generateFromDefaultEndpoint } from "./generateFromDefaultEndpoint";
import type { BackendModel } from "./models";

// Show result as JSON
export async function searchWeb(query: string) {
	const params = {
		q: query,
		hl: "en",
		gl: "us",
		google_domain: "google.com",
		api_key: SERPAPI_KEY,
	} satisfies GoogleParameters;

	// Show result as JSON
	const response = await getJson("google", params);

	return response;
}

export async function getQueryFromPrompt(
	messages: Pick<Message, "from" | "content">[],
	model: BackendModel
) {
	let prompt =
		model.userMessageToken +
		"The following messages were written by a user, trying to answer a question." +
		model.messageEndToken;

	prompt += messages
		.filter((message) => message.from === "user")
		.map((message) => model.userMessageToken + message.content + model.messageEndToken);

	prompt +=
		model.userMessageToken +
		"What query would you input into Google to answer the last question? Answer with a short (10 words max) plain-text query." +
		model.messageEndToken;
	prompt += model.assistantMessageToken;

	return await generateFromDefaultEndpoint(prompt);
}
