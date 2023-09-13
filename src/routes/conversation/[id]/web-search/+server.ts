import { authCondition } from "$lib/server/auth";
import { collections } from "$lib/server/database";
import { searchWeb } from "$lib/server/websearch/searchWeb";
import type { Message } from "$lib/types/Message";
import { error } from "@sveltejs/kit";
import { ObjectId } from "mongodb";
import { z } from "zod";
import type { WebSearch, WebSearchSource } from "$lib/types/WebSearch";
import { generateQuery } from "$lib/server/websearch/generateQuery";
import { parseWeb } from "$lib/server/websearch/parseWeb";
import { chunk } from "$lib/utils/chunk";
import { findSimilarSentences } from "$lib/server/websearch/sentenceSimilarity";
import { RATE_LIMIT } from "$env/static/private";
import { ERROR_MESSAGES } from "$lib/stores/errors.js";

const MAX_N_PAGES_SCRAPE = 10 as const;
const MAX_N_PAGES_EMBED = 5 as const;

export async function GET({ params, locals, url, getClientAddress }) {
	const convId = new ObjectId(params.id);
	const searchId = new ObjectId();

	const conv = await collections.conversations.findOne({
		_id: convId,
		...authCondition(locals),
	});

	if (!conv) {
		throw error(404, "Conversation not found");
	}

	const userId = locals.user?._id ?? locals.sessionId;

	await collections.messageEvents.insertOne({
		userId: userId,
		createdAt: new Date(),
		ip: getClientAddress(),
	});

	const nEvents = Math.max(
		await collections.messageEvents.countDocuments({ userId }),
		await collections.messageEvents.countDocuments({ ip: getClientAddress() })
	);

	if (RATE_LIMIT != "" && nEvents > parseInt(RATE_LIMIT)) {
		throw error(429, ERROR_MESSAGES.rateLimited);
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
				contextSources: [],
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
				webSearch.results =
					(results.organic_results &&
						results.organic_results.map((el: { title: string; link: string }) => {
							const { title, link } = el;
							const { hostname } = new URL(link);
							return { title, link, hostname };
						})) ??
					[];
				webSearch.results = webSearch.results
					.filter(({ link }) => !link.includes("youtube.com")) // filter out youtube links
					.slice(0, MAX_N_PAGES_SCRAPE); // limit to first 10 links only

				let paragraphChunks: { source: WebSearchSource; text: string }[] = [];
				if (webSearch.results.length > 0) {
					appendUpdate("Browsing results");
					const promises = webSearch.results.map(async (result) => {
						const { link } = result;
						let text = "";
						try {
							text = await parseWeb(link);
							appendUpdate("Browsing webpage", [link]);
						} catch (e) {
							console.error(`Error parsing webpage "${link}"`, e);
						}
						const CHUNK_CAR_LEN = 512;
						const MAX_N_CHUNKS = 100;
						const texts = chunk(text, CHUNK_CAR_LEN).slice(0, MAX_N_CHUNKS);
						return texts.map((t) => ({ source: result, text: t }));
					});
					const nestedParagraphChunks = (await Promise.all(promises)).slice(0, MAX_N_PAGES_EMBED);
					paragraphChunks = nestedParagraphChunks.flat();
					if (!paragraphChunks.length) {
						throw new Error("No text found on the first 5 results");
					}
				} else {
					throw new Error("No results found for this search query");
				}

				appendUpdate("Extracting relevant information");
				const topKClosestParagraphs = 8;
				const texts = paragraphChunks.map(({ text }) => text);
				const indices = await findSimilarSentences(prompt, texts, {
					topK: topKClosestParagraphs,
				});
				webSearch.context = indices.map((idx) => texts[idx]).join("");

				const usedSources = new Set<string>();
				for (const idx of indices) {
					const { source } = paragraphChunks[idx];
					if (!usedSources.has(source.link)) {
						usedSources.add(source.link);
						webSearch.contextSources.push(source);
					}
				}

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
				type: "sources",
				sources: webSearch.contextSources,
			});
			webSearch.messages.push({
				type: "result",
				id: res.insertedId.toString(),
			});
			controller.enqueue(JSON.stringify({ messages: webSearch.messages }));
		},
	});

	return new Response(stream, { headers: { "Content-Type": "application/json" } });
}
