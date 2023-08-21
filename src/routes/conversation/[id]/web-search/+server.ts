import { authCondition } from "$lib/server/auth";
import { collections } from "$lib/server/database";
import { defaultModel } from "$lib/server/models";
import { searchWeb } from "$lib/server/websearch/searchWeb";
import type { Message } from "$lib/types/Message";
import { error } from "@sveltejs/kit";
import { ObjectId } from "mongodb";
import { z } from "zod";
import type { WebSearch } from "$lib/types/WebSearch";
import { generateQuery } from "$lib/server/websearch/generateQuery";
import { parseWeb } from "$lib/server/websearch/parseWeb";
import { summarizeWeb } from "$lib/server/websearch/summarizeWeb";

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
				answerBox: "",
				results: [],
				summary: "",
				messages: [],
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			function appendUpdate(message: string, args?: string[], type?: "error" | "update") {
				webSearch.messages.push({
					type: type ?? "update",
					message,
					args,
				});
				controller.enqueue(JSON.stringify({ messages: webSearch.messages }));
			}

			try {
				appendUpdate("Generating search query");
				webSearch.searchQuery = await generateQuery(messages);

				appendUpdate("Searching Google", [webSearch.searchQuery]);
				const results = await searchWeb(webSearch.searchQuery);

				let text = "";
				webSearch.results =
					(results.organic_results &&
						results.organic_results.map((el: { link: string }) => el.link)) ??
					[];

				if (results.answer_box) {
					// if google returns an answer box, we use it
					webSearch.answerBox = JSON.stringify(removeLinks(results.answer_box));
					text = webSearch.answerBox;
					appendUpdate("Found a Google answer box");
				} else if (results.knowledge_graph) {
					// if google returns a knowledge graph, we use it
					webSearch.knowledgeGraph = JSON.stringify(removeLinks(results.knowledge_graph));
					text = webSearch.knowledgeGraph;
					appendUpdate("Found a Google knowledge page");
				} else if (webSearch.results.length > 0) {
					let tries = 0;

					while (!text && tries < 3) {
						const searchUrl = webSearch.results[tries];
						appendUpdate("Browsing result", [JSON.stringify(searchUrl)]);
						try {
							text = await parseWeb(searchUrl);
							if (!text) throw new Error("text of the webpage is null");
						} catch (e) {
							appendUpdate("Error parsing webpage", [], "error");
							tries++;
						}
					}
					if (!text) throw new Error("No text found on the first 3 results");
				} else {
					throw new Error("No results found for this search query");
				}

				appendUpdate("Creating summary");
				webSearch.summary = await summarizeWeb(text, webSearch.searchQuery, model);
				appendUpdate("Injecting summary", [JSON.stringify(webSearch.summary)]);
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
