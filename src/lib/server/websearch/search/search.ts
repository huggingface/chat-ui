import type { WebSearchSource } from "$lib/types/WebSearch";
import type { Message } from "$lib/types/Message";
import type { Assistant } from "$lib/types/Assistant";
import { getWebSearchProvider, searchWeb } from "./endpoints";
import { generateQuery } from "./generateQuery";
import { isURLStringLocal } from "$lib/server/isURLLocal";
import { isURL } from "$lib/utils/isUrl";

import z from "zod";
import JSON5 from "json5";
import { env } from "$env/dynamic/private";
import { makeGeneralUpdate } from "../update";
import type { MessageWebSearchUpdate } from "$lib/types/MessageUpdate";

const listSchema = z.array(z.string()).default([]);
const allowList = listSchema.parse(JSON5.parse(env.WEBSEARCH_ALLOWLIST));
const blockList = listSchema.parse(JSON5.parse(env.WEBSEARCH_BLOCKLIST));

export async function* search(
	messages: Message[],
	ragSettings?: Assistant["rag"],
	query?: string
): AsyncGenerator<
	MessageWebSearchUpdate,
	{ searchQuery: string; pages: WebSearchSource[] },
	undefined
> {
	const newLinks: string[] = [];
	let requireQuery = false;

	if (ragSettings && ragSettings?.allowedLinks.length > 0) {
		for (const link of ragSettings.allowedLinks) {
			if (link.includes("[query]")) {
				requireQuery = true;
				break;
			}
		}
		if (!requireQuery) {
			yield makeGeneralUpdate({ message: "Using links specified in Assistant" });
			return {
				searchQuery: "",
				pages: await directLinksToSource(ragSettings?.allowedLinks).then(filterByBlockList),
			};
		}
	}

	let searchQueries = await generateQuery(messages);
	if (!searchQueries.length && query) {
		searchQueries = [query];
	}

	for (const searchQuery of searchQueries) {
		if (ragSettings && ragSettings?.allowedLinks.length > 0) {
			for (const link of ragSettings.allowedLinks) {
				const newLink = link.replace("[query]", encodeURIComponent(searchQuery));
				if (!newLinks.includes(newLink)) {
					newLinks.push(newLink);
				}
			}
			yield makeGeneralUpdate({
				message: `Querying provided Endpoints with`,
				args: [searchQuery],
			});
		} else {
			yield makeGeneralUpdate({
				message: `Searching ${getWebSearchProvider()}`,
				args: [searchQuery],
			});
		}
	}

	if (newLinks.length > 0) {
		yield makeGeneralUpdate({ message: "Using links specified in Assistant" });
		return {
			searchQuery: "",
			pages: await directLinksToSource(newLinks).then(filterByBlockList),
		};
	}

	let combinedResults: WebSearchSource[] = [];

	for (const searchQuery of searchQueries) {
		// handle the global and (optional) rag lists
		if (ragSettings && ragSettings?.allowedDomains.length > 0) {
			yield makeGeneralUpdate({ message: "Filtering on specified domains" });
		}
		const filters = buildQueryFromSiteFilters(
			[...(ragSettings?.allowedDomains ?? []), ...allowList],
			blockList
		);

		const searchQueryWithFilters = `${filters} ${searchQuery}`;
		const searchResults = await searchWeb(searchQueryWithFilters).then(filterByBlockList);
		combinedResults = [...combinedResults, ...searchResults];
	}

	// re-sort the results by relevance
	// all results are appended to the end of the list
	// so the most relevant results are at the beginning
	// using num_searches iterating over the list to get the most relevant results
	// example input: [a1,a2,a3,a4,a5,b1,b2,b3,b4,b5,c1,c2,c3,c4,c5]
	// example output: [a1,b1,c1,a2,b2,c2,a3,b3,c3,a4,b4,c4,a5,b5,c5]
	const sortedResults = [];
	for (let i = 0; i < searchQueries.length; i++) {
		for (let j = i; j < combinedResults.length; j += searchQueries.length) {
			sortedResults.push(combinedResults[j]);
		}
	}

	return {
		searchQuery: searchQueries.join(" | "),
		pages: sortedResults,
	};
}

// ----------
// Utils
function filterByBlockList(results: WebSearchSource[]): WebSearchSource[] {
	return results.filter((result) => !blockList.some((blocked) => result.link.includes(blocked)));
}

function buildQueryFromSiteFilters(allow: string[], block: string[]) {
	return (
		allow.map((item) => "site:" + item).join(" OR ") +
		" " +
		block.map((item) => "-site:" + item).join(" ")
	);
}

async function directLinksToSource(links: string[]): Promise<WebSearchSource[]> {
	if (env.ENABLE_LOCAL_FETCH !== "true") {
		const localLinks = await Promise.all(links.map(isURLStringLocal));
		links = links.filter((_, index) => !localLinks[index]);
	}

	return links.filter(isURL).map((link) => ({
		link,
		title: "",
		text: [""],
	}));
}
