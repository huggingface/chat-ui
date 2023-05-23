import type { BackendModel } from "./server/models";
import { getQueryFromPrompt, searchWeb } from "./server/searchWeb";
import type { Message } from "./types/Message";
import { JSDOM } from "jsdom";
/**
 * Convert [{user: "assistant", content: "hi"}, {user: "user", content: "hello"}] to:
 *
 * <|assistant|>hi<|endoftext|><|prompter|>hello<|endoftext|><|assistant|>
 */

export async function buildPrompt(
	messages: Pick<Message, "from" | "content">[],
	model: BackendModel,
	webSearch?: true
): Promise<string> {
	const prompt =
		messages
			.map(
				(m) =>
					(m.from === "user"
						? model.userMessageToken + m.content
						: model.assistantMessageToken + m.content) +
					(model.messageEndToken
						? m.content.endsWith(model.messageEndToken)
							? ""
							: model.messageEndToken
						: "")
			)
			.join("") + model.assistantMessageToken;

	let webPrompt = "";

	if (webSearch) {
		const query = await getQueryFromPrompt(messages, model);
		console.log("query: ", query);
		const results = await searchWeb(query);

		// fetch the top result, summarize it and pass it in the context
		if (results.organic_results) {
			const topUrl = results.organic_results[0].link;
			console.log("top result :", topUrl);
			const htmlString = await fetch(topUrl)
				.then((response) => response.text())
				.catch((err) => console.log(err));

			const dom = new JSDOM(htmlString ?? "");
			const body = dom.window.document.querySelector("body");

			console.log(body?.textContent?.replace(/  |\r\n|\n|\r/gm, ""));
		}

		webPrompt =
			"<|context|>" +
			(results.organic_results
				? results.organic_results.map((element) => `- ${element.snippet}`).join("\n")
				: "No results found.") +
			model.messageEndToken;
	}

	const finalPrompt =
		model.preprompt +
		webPrompt +
		prompt
			.split(" ")
			.slice(-(model.parameters?.truncate ?? 0))
			.join(" ");

	// Not super precise, but it's truncated in the model's backend anyway
	return finalPrompt;
}
