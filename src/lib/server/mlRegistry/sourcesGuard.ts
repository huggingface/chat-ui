import type { ObjectId } from "mongodb";
import { logger } from "$lib/server/logger";
import { isExaMcpServer, isHfMcpServer } from "$lib/server/mcp/hf";
import type {
	GuardedToolCall,
	GuardOutcome,
	GuardVerdict,
	ToolCallGuard,
} from "$lib/server/textGeneration/mcp/toolGuard";
import {
	hfSighting,
	hubRepoSighting,
	recordSources,
	webSighting,
	type SourceSighting,
} from "./sources";

// books nothing in before and emits no update, so it may sit anywhere in a chain
// a failed write is logged and never thrown, bookkeeping must not break the tool round

type HfRead = { index: number; uri: string; firstPage: boolean };

type Ticket =
	| { kind: "hf_fs"; reads: HfRead[] }
	| { kind: "crawl"; urls: string[] }
	| { kind: "search" }
	| { kind: "repo_details"; ids: string[]; type?: HubType };

type HubType = "model" | "dataset" | "space";

const READ_COMMANDS = new Set(["cat", "attach"]);
const SEARCH_TOOLS = new Set(["web_search_exa", "get_code_context_exa"]);
const HUB_TYPES = new Set<string>(["model", "dataset", "space"]);

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
	typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
const asString = (value: unknown): string | undefined =>
	typeof value === "string" && value.length > 0 ? value : undefined;
const strings = (value: unknown): string[] =>
	Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

function hfReads(args: Record<string, unknown>): HfRead[] {
	const operations = Array.isArray(args.operations) ? args.operations : [];
	const reads: HfRead[] = [];
	operations.forEach((raw, index) => {
		const operation = asRecord(raw);
		if (!operation || !READ_COMMANDS.has(String(operation.cmd))) return;
		const tokens = strings(operation.args);
		const uri = tokens.find((token) => token.startsWith("hf://"));
		if (!uri) return;
		const offset = tokens[tokens.indexOf("--offset") + 1];
		const firstPage = !tokens.includes("--offset") || Number(offset) === 0;
		reads.push({ index, uri, firstPage });
	});
	return reads;
}

function classify(call: GuardedToolCall): Ticket | undefined {
	if (isHfMcpServer(call.serverUrl)) {
		if (call.tool === "hf_fs") {
			const reads = hfReads(call.args);
			return reads.length ? { kind: "hf_fs", reads } : undefined;
		}
		if (call.tool === "hub_repo_details") {
			const ids = strings(call.args.repo_ids);
			const type = asString(call.args.repo_type);
			return ids.length
				? {
						kind: "repo_details",
						ids,
						...(type && HUB_TYPES.has(type) ? { type: type as HubType } : {}),
					}
				: undefined;
		}
		return undefined;
	}
	if (isExaMcpServer(call.serverUrl)) {
		if (SEARCH_TOOLS.has(call.tool)) return { kind: "search" };
		if (call.tool === "crawling_exa") {
			const urls = strings(call.args.urls);
			return urls.length ? { kind: "crawl", urls } : undefined;
		}
	}
	return undefined;
}

/** a paper page opens with its title and a docs page with its heading, on the first page only */
function titleFromContent(uri: string, content: unknown): string | undefined {
	const firstLine = asString(content)?.split("\n", 1)[0];
	if (!firstLine) return undefined;
	if (uri.startsWith("hf://papers/")) return /^Title:\s*(.+)$/.exec(firstLine)?.[1];
	if (uri.startsWith("hf://docs/")) return /^#\s+(.+)$/.exec(firstLine)?.[1];
	return undefined;
}

// an operation that failed in the batch is not a read
function hfFsSightings(reads: HfRead[], structured: unknown): SourceSighting[] {
	const results = asRecord(structured)?.results;
	const byIndex = new Map<number, Record<string, unknown>>();
	if (Array.isArray(results)) {
		for (const raw of results) {
			const entry = asRecord(raw);
			if (entry && typeof entry.index === "number") byIndex.set(entry.index, entry);
		}
	}
	const sightings: SourceSighting[] = [];
	for (const read of reads) {
		const entry = byIndex.get(read.index);
		if (Array.isArray(results) && entry?.status !== "success") continue;
		const result = asRecord(entry?.result);
		const uri = asString(result?.uri) ?? read.uri;
		const title = read.firstPage ? titleFromContent(uri, result?.content) : undefined;
		const sighting = hfSighting(uri, { opened: true, ...(title ? { title } : {}) });
		if (sighting) sightings.push(sighting);
	}
	return sightings;
}

/**
 * results parsed from the exa search reply text
 * @example
 * Title: A blog post
 * URL: https://example.com/post
 * ---
 * Title: Another post
 * URL: https://example.com/other
 */
export function exaSearchResults(text: string): { url: string; title?: string }[] {
	const results: { url: string; title?: string }[] = [];
	for (const block of text.split(/^---$/m)) {
		const url = /^URL:\s*(\S+)\s*$/m.exec(block)?.[1];
		if (!url) continue;
		const title = /^Title:\s*(.+)$/m.exec(block)?.[1]?.trim();
		results.push({ url, ...(title ? { title } : {}) });
	}
	return results;
}

function searchResults(outcome: { text: string; structured?: unknown }) {
	const structured = asRecord(outcome.structured)?.results;
	if (Array.isArray(structured)) {
		const results = structured.flatMap((raw) => {
			const entry = asRecord(raw);
			const url = asString(entry?.url);
			const title = asString(entry?.title);
			return url ? [{ url, ...(title ? { title } : {}) }] : [];
		});
		if (results.length) return results;
	}
	return exaSearchResults(outcome.text);
}

/**
 * pages parsed from the exa crawl reply text, page text can hold url lines too so only requested urls count
 * @example
 * # Migration guide
 * URL: https://example.com/guide
 * Error fetching https://broken.example.com/x: CRAWL_NOT_FOUND
 */
export function crawledPages(text: string, requested: string[]): { url: string; title?: string }[] {
	const wanted = new Set(requested);
	const pages: { url: string; title?: string }[] = [];
	const lines = text.split("\n");
	lines.forEach((line, i) => {
		const url = /^URL:\s*(\S+)\s*$/.exec(line)?.[1];
		if (!url || !wanted.has(url)) return;
		const title = /^#\s+(.+)$/.exec(lines[i - 1] ?? "")?.[1]?.trim();
		pages.push({ url, ...(title ? { title } : {}) });
	});
	if (pages.length) return pages;
	// the reply spelled the urls differently, so the arguments stand in minus the failures
	const failed = new Set(
		[...text.matchAll(/^Error fetching (\S+?):?\s/gm)].map((match) => match[1])
	);
	return requested.filter((url) => !failed.has(url)).map((url) => ({ url }));
}

const HUB_TYPE_BY_LABEL: Record<string, HubType> = {
	model: "model",
	dataset: "dataset",
	space: "space",
};

/**
 * repos parsed from the hub_repo_details reply text, one block per repo
 * @example
 * **Type: Dataset**
 * # HuggingFaceH4/ultrachat_200k
 */
export function repoDetailsFound(text: string): { id: string; type: HubType }[] {
	const found: { id: string; type: HubType }[] = [];
	for (const block of text.split(/^---$/m)) {
		const label = /^\*\*Type:\s*(\w+)\*\*/m.exec(block)?.[1]?.toLowerCase();
		const id = /^#\s+(\S+\/\S+)\s*$/m.exec(block)?.[1];
		const type = label ? HUB_TYPE_BY_LABEL[label] : undefined;
		if (id && type) found.push({ id, type });
	}
	return found;
}

function repoDetailsSightings(
	ticket: { ids: string[]; type?: HubType },
	text: string
): SourceSighting[] {
	const asked = new Set(ticket.ids.map((id) => id.toLowerCase()));
	const found = repoDetailsFound(text).filter(({ id }) => asked.has(id.toLowerCase()));
	// without a type the id could be any of the three, so nothing is guessed
	const repos = found.length
		? found
		: ticket.type
			? ticket.ids.map((id) => ({ id, type: ticket.type as HubType }))
			: [];
	return repos.flatMap(({ id, type }) => hubRepoSighting(type, id) ?? []);
}

function sightingsFor(ticket: Ticket, outcome: { text: string; structured?: unknown }) {
	switch (ticket.kind) {
		case "hf_fs":
			return hfFsSightings(ticket.reads, outcome.structured);
		case "search":
			return searchResults(outcome).flatMap(
				({ url, title }) => webSighting(url, { opened: false, title }) ?? []
			);
		case "crawl":
			return crawledPages(outcome.text, ticket.urls).flatMap(
				({ url, title }) => webSighting(url, { opened: true, title }) ?? []
			);
		case "repo_details":
			return repoDetailsSightings(ticket, outcome.text);
	}
}

/** readBy is PARENT_READER in the main loop, the run id inside a sub-agent */
export function createMlSourcesGuard({
	conversationId,
	readBy,
}: {
	conversationId: ObjectId;
	readBy: string;
}): ToolCallGuard {
	return {
		allowParking: true,

		async before(call: GuardedToolCall): Promise<GuardVerdict> {
			const ticket = classify(call);
			return ticket ? { allow: true, ticket } : { allow: true };
		},

		async after(rawTicket: unknown, outcome: GuardOutcome) {
			if (outcome.status !== "success") return undefined;
			const ticket = rawTicket as Ticket;
			try {
				await recordSources(conversationId, readBy, sightingsFor(ticket, outcome));
			} catch (err) {
				logger.error(
					{ err: String(err), conversationId: conversationId.toString(), kind: ticket.kind },
					"[mlRegistry] recording sources failed"
				);
			}
			return undefined;
		},
	};
}
