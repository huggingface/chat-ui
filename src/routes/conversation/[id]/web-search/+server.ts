import { authCondition } from "$lib/server/auth";
import { collections } from "$lib/server/database";
import { searchWeb } from "$lib/server/websearch/searchWeb";
import type { Message } from "$lib/types/Message";
import { error } from "@sveltejs/kit";
import { ObjectId } from "mongodb";
import { z } from "zod";
import type { WebSearch } from "$lib/types/WebSearch";
import { generateQuery } from "$lib/server/websearch/generateQuery";
import { parseWeb } from "$lib/server/websearch/parseWeb";
import { chunk } from "$lib/utils/chunk.js";
import { client as gradioClient } from "@gradio/client";

interface GradioResult {
	type: string;
	endpoint: string;
	fn_index: string;
	data: string[];
	time: Date;
}

export async function GET({ params, locals, url }) {
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
				results: [],
				context: "",
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
				webSearch.results = [
					...((results.top_stories && results.top_stories.map((el: { link: string }) => el.link)) ??
						[]),
					...((results.organic_results &&
						results.organic_results.map((el: { link: string }) => el.link)) ??
						[]),
				];
				webSearch.results = webSearch.results
					.filter((link) => !link.includes("youtube.com")) // filter out youtube links
					.slice(0, 5); // limit to first 5 links only

				let paragraphChunks: string[] = [];
				if (webSearch.results.length > 0) {
					appendUpdate("Browsing results", [JSON.stringify(webSearch.results)]);
					const promises = webSearch.results.map(async (link) => {
						let text = "";
						try {
							text = await parseWeb(link);
						} catch (e) {
							console.error(`Error parsing webpage "${link}"`, e);
							appendUpdate("Error parsing webpage", [link], "error");
						}
						const CHUNK_CAR_LEN = 512;
						const MAX_N_CHUNKS = 100;
						const chunks = chunk(text, CHUNK_CAR_LEN).slice(0, MAX_N_CHUNKS);
						return chunks;
					});
					const nestedParagraphChunks = await Promise.all(promises);
					paragraphChunks = nestedParagraphChunks.flat();
					if (!paragraphChunks.length) {
						throw new Error("No text found on the first 5 results");
					}
				} else {
					throw new Error("No results found for this search query");
				}

				appendUpdate("Extracing relevant information");
				const topKClosestParagraphs = 8;
				const gradioApp = await gradioClient("https://mishig-embeddings-similarity.hf.space/", {});
				const result = (await gradioApp.predict("/predict", [
					webSearch.searchQuery,
					paragraphChunks.join("-HFSEP-"), // see: https://huggingface.co/spaces/mishig/embeddings-similarity/blob/main/app.py#L10
					topKClosestParagraphs,
				])) as GradioResult;
				const indices: number[] = JSON.parse(result.data[0]);
				webSearch.context = indices.map((idx) => paragraphChunks[idx]).join("");
				appendUpdate("Injecting relevant information");
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
