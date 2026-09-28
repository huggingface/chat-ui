export type HfHubResourceType = "model" | "dataset" | "space";

export interface HfHubResource {
	id: string;
	type: HfHubResourceType;
	emoji?: string;
}

export interface HfHubMention {
	query: string;
	start: number;
	end: number;
}

const HUB_QUICKSEARCH_URL = "https://huggingface.co/api/quicksearch";
const RESULTS_PER_TYPE = 5;
const REPO_ID_CHARS = "A-Za-z0-9._/-";
// Built once: `findHfHubMention` runs from every textarea event that can move
// the caret, so recompiling these per keystroke is pure waste. Neither uses the
// `g` flag, so there is no `lastIndex` to share between calls.
const MENTION_AT_CARET_REGEX = new RegExp(`(?:^|[\\s([{])@([${REPO_ID_CHARS}]*)$`);
const MENTION_TAIL_REGEX = new RegExp(`^[${REPO_ID_CHARS}]*`);

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

/** Find the Hub mention being edited at the current textarea caret. */
export function findHfHubMention(value: string, caret: number): HfHubMention | null {
	const safeCaret = Math.max(0, Math.min(caret, value.length));
	const beforeCaret = value.slice(0, safeCaret);
	const match = MENTION_AT_CARET_REGEX.exec(beforeCaret);

	if (!match) return null;

	const query = match[1];
	const start = safeCaret - query.length - 1;
	const tail = MENTION_TAIL_REGEX.exec(value.slice(safeCaret))?.[0] ?? "";

	return { query, start, end: safeCaret + tail.length };
}

/** Replace only the mention around the caret and leave surrounding prompt text intact. */
export function replaceHfHubMention(
	value: string,
	mention: HfHubMention,
	resourceId: string
): { value: string; caret: number } {
	const suffix = value.slice(mention.end);
	const addSpace = suffix.length === 0 || (!/^\s/.test(suffix) && !/^[,.;:!?)\]}]/.test(suffix));
	const replacement = `@${resourceId}${addSpace ? " " : ""}`;

	return {
		value: value.slice(0, mention.start) + replacement + suffix,
		caret: mention.start + replacement.length,
	};
}

export function parseHfHubQuicksearch(payload: unknown): HfHubResource[] {
	if (!isRecord(payload)) return [];

	const resources: HfHubResource[] = [];
	const groups: Array<{ key: string; type: HfHubResourceType }> = [
		{ key: "models", type: "model" },
		{ key: "datasets", type: "dataset" },
		{ key: "spaces", type: "space" },
	];

	for (const { key, type } of groups) {
		const entries = payload[key];
		if (!Array.isArray(entries)) continue;
		let groupCount = 0;

		for (const entry of entries) {
			if (!isRecord(entry) || typeof entry.id !== "string" || !entry.id) continue;

			resources.push({
				id: entry.id,
				type,
				...(type === "space" && typeof entry.emoji === "string" ? { emoji: entry.emoji } : {}),
			});
			groupCount += 1;
			if (groupCount === RESULTS_PER_TYPE) break;
		}
	}

	return resources;
}

export async function searchHfHub(
	query: string,
	signal?: AbortSignal,
	fetcher: typeof fetch = fetch
): Promise<HfHubResource[]> {
	const url = new URL(HUB_QUICKSEARCH_URL);
	url.searchParams.set("q", query);
	url.searchParams.set("limit", String(RESULTS_PER_TYPE));

	const response = await fetcher(url, { signal });
	if (!response.ok) {
		throw new Error(`Hugging Face Hub search failed with status ${response.status}`);
	}

	return parseHfHubQuicksearch(await response.json());
}
