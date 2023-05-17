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
	let prompt = "What query would you ask Google to answer this question?\n\n";

	messages.forEach((message) => {
		prompt += `${message.from}: ${message.content}\n`;
	});

	prompt += "\nQuery:";

	return await generateFromDefaultEndpoint(prompt);
}
