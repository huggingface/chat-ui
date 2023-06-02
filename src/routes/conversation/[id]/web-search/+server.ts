import { authCondition } from "$lib/server/auth";
import { collections } from "$lib/server/database";
import { generateFromDefaultEndpoint } from "$lib/server/generateFromDefaultEndpoint.js";
import { defaultModel } from "$lib/server/models";
import { searchWeb } from "$lib/server/searchWeb.js";
import type { Message } from "$lib/types/Message.js";
import { error } from "@sveltejs/kit";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { JSDOM, VirtualConsole } from "jsdom";
import type { WebSearch } from "$lib/types/WebSearch.js";

function removeTags(node: Node) {
	if (node.hasChildNodes()) {
		node.childNodes.forEach((childNode) => {
			if (node.nodeName === "SCRIPT" || node.nodeName === "STYLE") {
				node.removeChild(childNode);
			} else {
				removeTags(childNode);
			}
		});
	}
}
function naiveInnerText(node: Node): string {
	const Node = node; // We need Node(DOM's Node) for the constants, but Node doesn't exist in the nodejs global space, and any Node instance references the constants through the prototype chain
	return [...node.childNodes]
		.map((childNode) => {
			switch (childNode.nodeType) {
				case Node.TEXT_NODE:
					return node.textContent;
				case Node.ELEMENT_NODE:
					return naiveInnerText(childNode);
				default:
					return "";
			}
		})
		.join("\n");
}

interface GenericObject {
	[key: string]: GenericObject | unknown;
}

function removeLinks(obj: GenericObject) {
	for (const prop in obj) {
		if (prop.endsWith("link")) delete obj[prop];
		else if (typeof obj[prop] === "object") removeLinks(obj[prop] as GenericObject);
	}
	return obj;
}
export async function GET({ params, locals, url }) {
	const model = defaultModel;
	const convId = new ObjectId(params.id);
	const searchId = new ObjectId();

	const conv = await collections.conversations.findOne({
		_id: convId,
		...authCondition(locals),
	});

	if (!conv) {
		throw error(404, "Conversation not found");
	}

	const prompt = z.string().trim().min(1).parse(url.searchParams.get("prompt"));

	const messages = (() => {
		return [...conv.messages, { content: prompt, from: "user", id: crypto.randomUUID() }];
	})() satisfies Message[];

	const stream = new ReadableStream({
		async start(controller) {
			const webSearch: WebSearch = {
				_id: searchId,
				convId: convId,
				prompt: prompt,
				searchQuery: "",
				knowledgeGraph: "",
				results: [],
				summary: "",
				messages: [],
				createdAt: new Date(),
				updatedAt: new Date(),
			};
			try {
				webSearch.messages.push({
					type: "update",
					message: "Generating search query",
				});
				controller.enqueue(JSON.stringify({ messages: webSearch.messages }));

				const promptSearchQuery =
					model.userMessageToken +
					"The following messages were written by a user, trying to answer a question." +
					model.messageEndToken +
					messages
						.filter((message) => message.from === "user")
						.map((message) => model.userMessageToken + message.content + model.messageEndToken) +
					model.userMessageToken +
					"What plain-text english sentence would you input into Google to answer the last question? Answer with a short (10 words max) simple sentence." +
					model.messageEndToken +
					model.assistantMessageToken +
					"Query: ";

				webSearch.searchQuery = await generateFromDefaultEndpoint(promptSearchQuery).then(
					(query) => {
						const arr = query.split(/\r?\n/);
						return arr[0].length > 0 ? arr[0] : arr[1];
					}
				);
				// the model has a tendency to continue answering even when we tell it not to, so the split makes
				// sure we only get the first line of the response

				webSearch.messages.push({
					type: "update",
					message: "Searching Google",
					args: [webSearch.searchQuery],
				});
				controller.enqueue(JSON.stringify({ messages: webSearch.messages }));

				const results = await searchWeb(webSearch.searchQuery);
				let text = "";

				webSearch.results =
					(results.organic_results &&
						results.organic_results.map((el: { link: string }) => el.link)) ??
					[];

				if (results.knowledge_graph) {
					// if google returns a knowledge graph, we use it
					webSearch.knowledgeGraph = JSON.stringify(removeLinks(results.knowledge_graph));

					text = webSearch.knowledgeGraph;

					webSearch.messages.push({
						type: "update",
						message: "Found a Google knowledge page",
					});
					controller.enqueue(JSON.stringify({ messages: webSearch.messages }));
				} else if (webSearch.results.length > 0) {
					// otherwise we use the top result from search
					const topUrl = webSearch.results[0];

					webSearch.messages.push({
						type: "update",
						message: "Browsing first result",
						args: [JSON.stringify(topUrl)],
					});
					controller.enqueue(JSON.stringify({ messages: webSearch.messages }));

					// fetch the webpage
					//10 second timeout:
					const abortController = new AbortController();
					setTimeout(() => abortController.abort(), 10000);
					const htmlString = await fetch(topUrl, { signal: abortController.signal })
						.then((response) => response.text())
						.catch((err) => console.log(err));

					const virtualConsole = new VirtualConsole();
					virtualConsole.on("error", () => {
						// No-op to skip console errors.
					});

					// put the html string into a DOM
					const dom = new JSDOM(htmlString ?? "", {
						virtualConsole,
					});

					const body = dom.window.document.querySelector("body");
					if (!body) throw new Error("body of the webpage is null");

					removeTags(body);

					// recursively extract text content from the body and then remove newlines and multiple spaces
					text = (naiveInnerText(body) ?? "").replace(/ {2}|\r\n|\n|\r/gm, "");

					if (!text) throw new Error("text of the webpage is null");
				} else {
					throw new Error("No results found for this search query");
				}

				webSearch.messages.push({
					type: "update",
					message: "Creating summary",
				});
				controller.enqueue(JSON.stringify({ messages: webSearch.messages }));

				const summaryPrompt =
					model.userMessageToken +
					text
						.split(" ")
						.slice(0, model.parameters?.truncate ?? 0)
						.join(" ") +
					model.messageEndToken +
					model.userMessageToken +
					`The text above should be summarized to best answer the query: ${webSearch.searchQuery}.` +
					model.messageEndToken +
					model.assistantMessageToken +
					"Summary: ";

				webSearch.summary = await generateFromDefaultEndpoint(summaryPrompt).then((txt: string) =>
					txt.trim()
				);

				webSearch.messages.push({
					type: "update",
					message: "Injecting summary",
					args: [JSON.stringify(webSearch.summary)],
				});
				controller.enqueue(JSON.stringify({ messages: webSearch.messages }));
			} catch (searchError) {
				if (searchError instanceof Error) {
					webSearch.messages.push({
						type: "error",
						message: "An error occurred with the web search",
						args: [JSON.stringify(searchError.message)],
					});
				}
			}

			const res = await collections.webSearches.insertOne(webSearch);

			webSearch.messages.push({
				type: "result",
				id: res.insertedId.toString(),
			});
			controller.enqueue(JSON.stringify({ messages: webSearch.messages }));
		},
	});

	return new Response(stream, { headers: { "Content-Type": "application/json" } });
}
