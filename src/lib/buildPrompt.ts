import type { BackendModel } from "./server/models";
import { getQueryFromPrompt, searchWeb } from "./server/searchWeb";
import type { Message } from "./types/Message";

/**
 * Convert [{user: "assistant", content: "hi"}, {user: "user", content: "hello"}] to:
 *
 * <|assistant|>hi<|endoftext|><|prompter|>hello<|endoftext|><|assistant|>
 */

interface SearchResult {
	title: string;
	snippet: string;
	link: string;
}

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
		const query = await getQueryFromPrompt(messages);
		console.log(query);
		const results = await searchWeb(query);

		webPrompt = "<|context|>";

		if (results.organic_results === undefined) {
			webPrompt += "No results found.";
		} else {
			results.organic_results.forEach((element: SearchResult) => {
				webPrompt += `\n- ${element.snippet}`;
			});
		}

		webPrompt += model.messageEndToken;
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
