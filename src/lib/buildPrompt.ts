import type { BackendModel } from "./server/models";
import { getQueryFromPrompt, searchWeb } from "./server/searchWeb";
import type { Message } from "./types/Message";
import { JSDOM } from "jsdom";
import { generateFromDefaultEndpoint } from "./server/generateFromDefaultEndpoint";
/**
 * Convert [{user: "assistant", content: "hi"}, {user: "user", content: "hello"}] to:
 *
 * <|assistant|>hi<|endoftext|><|prompter|>hello<|endoftext|><|assistant|>
 */

function naiveInnerText(node: Node) {
	const Node = node; // We need Node(DOM's Node) for the constants, but Node doesn't exist in the nodejs global space, and any Node instance references the constants through the prototype chain
	return [...node.childNodes]
		.map((node) => {
			switch (node.nodeType) {
				case Node.TEXT_NODE:
					return node.textContent;
				case Node.ELEMENT_NODE:
					return naiveInnerText(node);
				default:
					return "";
			}
		})
		.join("\n");
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
		const query = await getQueryFromPrompt(messages, model);
		console.log("query: ", query);
		const results = await searchWeb(query);

		// fetch the top result, summarize it and pass it in the context
		if (results.organic_results) {
			const topUrl = results.organic_results[0].link;
			console.log("top result :", topUrl);

			// fetch the webpage
			const htmlString = await fetch(topUrl)
				.then((response) => response.text())
				.catch((err) => console.log(err));

			// extract the text content of the body element
			const dom = new JSDOM(htmlString ?? "");
			const body = dom.window.document.querySelector("body");

			if (body === null) throw new Error("body is null");

			const text = (naiveInnerText(body) ?? "").replace(/ {2}|\r\n|\n|\r/gm, "");

			console.log(text);
			// if there is a text, summarize it,
			// TODO: This could be improved by using a dedicated summarization model if we have an endpoint for it.
			if (text) {
				const summaryPrompt =
					model.userMessageToken +
					text +
					model.messageEndToken +
					model.userMessageToken +
					`The text above should be summarized to best answer the query: ${query}.` +
					model.messageEndToken +
					model.assistantMessageToken +
					"Summary: ";

				const summary = await generateFromDefaultEndpoint(summaryPrompt);
				console.log("summary: ", summary);

				if (summary) {
					webPrompt =
						`<|context|> The following context was found on the internet (${topUrl}) : ${summary}` +
						model.messageEndToken;
				}
			}
		}
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
