import { SERPAPI_KEY } from "$env/static/private";
import type { Message } from "$lib/types/Message";

import { getJson } from "serpapi";
import type { GoogleParameters } from "serpapi";
import { generateFromDefaultEndpoint } from "./generateFromDefaultEndpoint";

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

export async function getQueryFromPrompt(messages: Pick<Message, "from" | "content">[]) {
	let prompt =
		"<|prompter|>The following messages were written by a user, trying to answer a question.\n";

	messages
		.filter((message) => message.from === "user")
		.forEach((message) => {
			prompt += `<|${message.from}|> ${message.content}</s>`;
		});

	prompt +=
		"<|prompter|>What plain-text short (less than 10 words) sentence would you input into Google to answer the last question? Answer with just the query.\n</s>";
	prompt += "<|assistant|>";

	return await generateFromDefaultEndpoint(prompt);
}
