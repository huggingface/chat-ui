import type { WebSearchSource } from "$lib/types/WebSearch";
import type { Message } from "$lib/types/Message";
import type { Assistant } from "$lib/types/Assistant";
import type { AppendUpdate } from "../runWebSearch";
import { getWebSearchProvider, searchWeb } from "./endpoints";
import { generateQuery } from "./generateQuery";
import { isURLStringLocal } from "$lib/server/isURLLocal";
import { isURL } from "$lib/utils/isUrl";

import z from "zod";
import JSON5 from "json5";
import { env } from "$env/dynamic/private";

const listSchema = z.array(z.string()).default([]);
const allowList = listSchema.parse(JSON5.parse(env.WEBSEARCH_ALLOWLIST));
const blockList = listSchema.parse(JSON5.parse(env.WEBSEARCH_BLOCKLIST));

export async function search(
	messages: Message[],
	ragSettings: Assistant["rag"] | undefined,
	appendUpdate: AppendUpdate
): Promise<{ searchQuery: string; pages: WebSearchSource[] }> {
	if (ragSettings && ragSettings?.allowedLinks.length > 0) {
		appendUpdate("Using links specified in Assistant");
		return {
			searchQuery: "",
			pages: await directLinksToSource(ragSettings.allowedLinks).then(filterByBlockList),
		};
	}

	const searchQuery = await generateQuery(messages);
	appendUpdate(`Searching ${getWebSearchProvider()}`, [searchQuery]);

	// handle the global and (optional) rag lists
	if (ragSettings && ragSettings?.allowedDomains.length > 0) {
		appendUpdate("Filtering on specified domains");
	}
	const filters = buildQueryFromSiteFilters(
		[...(ragSettings?.allowedDomains ?? []), ...allowList],
		blockList
	);

	const searchQueryWithFilters = `${filters} ${searchQuery}`;
	const searchResults = await searchWeb(searchQueryWithFilters).then(filterByBlockList);

	return {
		searchQuery: searchQueryWithFilters,
		pages: searchResults,
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
