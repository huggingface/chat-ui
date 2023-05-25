import { authCondition } from "$lib/server/auth";
import { collections } from "$lib/server/database";
import { generateFromDefaultEndpoint } from "$lib/server/generateFromDefaultEndpoint.js";
import { defaultModel } from "$lib/server/models";
import { searchWeb } from "$lib/server/searchWeb.js";
import type { Message } from "$lib/types/Message.js";
import { error } from "@sveltejs/kit";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { JSDOM } from "jsdom";

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
export async function GET({ request, params, locals, url }) {
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

	const searchQuery = await generateFromDefaultEndpoint(promptSearchQuery).then(
		(query) => query.split(/\r?\n/)[0]
	);
	// the model has a tendency to continue answering even when we tell it not to, so the split makes
	// sure we only get the first line of the response

	const results = await searchWeb(searchQuery);
	let text = "";

	if (results.knowledge_graph) {
		// if google returns a knowledge graph, we use it
		text = JSON.stringify(removeLinks(results.knowledge_graph));
	} else if (results.organic_results) {
		// otherwise we use the top result from search
		const topUrl = results.organic_results[0].link;
		//10 second timeout:
		const controller = new AbortController();
		setTimeout(() => controller.abort(), 10000);
		// fetch the webpage
		const htmlString = await fetch(topUrl, { signal: controller.signal })
			.then((response) => response.text())
			.catch((err) => console.log(err));

		// put the html string into a DOM
		const dom = new JSDOM(htmlString ?? "");
		const body = dom.window.document.querySelector("body");

		if (!body) throw new Error("body is null");
		// recursively extract text content from the body and remove newlines and multiple spaces
		text = (naiveInnerText(body) ?? "").replace(/ {2}|\r\n|\n|\r/gm, "");

		if (!text) throw new Error("text is null");
	} else {
		throw new Error("No results found");
	}

	const summaryPrompt =
		model.userMessageToken +
		text +
		model.messageEndToken +
		model.userMessageToken +
		`The text above should be summarized to best answer the query: ${searchQuery}.` +
		model.messageEndToken +
		model.assistantMessageToken +
		"Summary: ";

	const summary = await generateFromDefaultEndpoint(summaryPrompt);

	const res = await collections.webSearches.insertOne({
		_id: searchId,
		convId: convId,
		prompt: prompt,
		searchQuery: searchQuery,
		knowledgeGraph: results.knowledge_graph && JSON.stringify(removeLinks(results.knowledge_graph)),
		results: results.organic_results && results.organic_results.map((result) => result.link),
		summary: summary,
		createdAt: new Date(),
		updatedAt: new Date(),
	});

	console.log(res.insertedId.toString());
	return new Response(
		JSON.stringify({
			id: res.insertedId.toString(),
			searchQuery,
			summary,
		}),
		{ headers: { "Content-Type": "application/json" } }
	);
}
