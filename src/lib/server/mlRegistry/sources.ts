import type { ObjectId } from "mongodb";
import { collections } from "$lib/server/database";
import type { MlSource, MlSourceKind } from "$lib/types/MlSource";
import { fileUrl, parseHfUri, repoUrl } from "./hubUri";

export const PAPERS_GROUP = "Hugging Face papers";
export const DOCS_GROUP = "Hugging Face docs";

const URL_MAX = 2_048;
const TITLE_MAX = 200;

/** one sighting, several of one url in a call are merged before writing */
export interface SourceSighting {
	url: string;
	group: string;
	kind: MlSourceKind;
	title?: string;
	opened: boolean;
}

const HUB = "https://huggingface.co";
const encodePath = (segments: string[]) => segments.map(encodeURIComponent).join("/");

// a docs uri carries the release it was read from, the site serves the page without one
const DOCS_VERSION = /^(?:v\d+(?:\.\d+)+(?:[.-]?\w+)?|main)$/;
const PAPER_ID = /^[\w.-]+$/;

function cleanTitle(title: string | undefined): string | undefined {
	const trimmed = title?.replace(/\s+/g, " ").trim();
	if (!trimmed) return undefined;
	return trimmed.length > TITLE_MAX ? `${trimmed.slice(0, TITLE_MAX)}…` : trimmed;
}

/** a page on the web, grouped by its host, anything but http and https is dropped since the pane links to it */
export function webSighting(
	raw: string,
	{ opened, title }: { opened: boolean; title?: string }
): SourceSighting | undefined {
	let url: URL;
	try {
		url = new URL(raw.trim());
	} catch {
		return undefined;
	}
	if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
	url.hash = "";
	url.username = "";
	url.password = "";
	const href = url.toString();
	if (href.length > URL_MAX) return undefined;
	const cleaned = cleanTitle(title);
	return {
		url: href,
		group: url.hostname.toLowerCase().replace(/^www\./, ""),
		kind: "web",
		opened,
		...(cleaned ? { title: cleaned } : {}),
	};
}

/** an hf_fs read mapped to the page a person would open, buckets and collections are not sources */
export function hfSighting(
	raw: string,
	{ opened, title }: { opened: boolean; title?: string }
): SourceSighting | undefined {
	const uri = raw.trim().replace(/#.*$/, "");
	const cleaned = cleanTitle(title);
	const withTitle = (sighting: SourceSighting): SourceSighting =>
		cleaned ? { ...sighting, title: cleaned } : sighting;

	const paper = /^hf:\/\/papers\/([^/]+)/.exec(uri);
	if (paper) {
		if (!PAPER_ID.test(paper[1])) return undefined;
		return withTitle({
			url: `${HUB}/papers/${encodeURIComponent(paper[1])}`,
			group: PAPERS_GROUP,
			kind: "paper",
			opened,
		});
	}

	const docs = /^hf:\/\/docs\/(.+)$/.exec(uri);
	if (docs) {
		const [library, ...rest] = docs[1].split("/").filter(Boolean);
		if (!library) return undefined;
		const page = rest.length > 1 && DOCS_VERSION.test(rest[0]) ? rest.slice(1) : rest;
		if (page.length) page[page.length - 1] = page[page.length - 1].replace(/\.mdx?$/, "");
		return withTitle({
			url: `${HUB}/docs/${encodePath([library, ...page])}`,
			group: DOCS_GROUP,
			kind: "docs",
			opened,
		});
	}

	const repo = parseHfUri(uri);
	if (!repo || repo.type === "buckets") return undefined;
	return withTitle({
		url: repo.path ? fileUrl({ ...repo, path: repo.path }) : repoUrl(repo),
		group: `${repo.owner}/${repo.name}`,
		kind: "hub",
		opened,
	});
}

const HUB_REPO_ID = /^[A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*$/;
const HUB_PREFIX = { model: "", dataset: "datasets/", space: "spaces/" } as const;

/** the page of the repo hub_repo_details describes */
export function hubRepoSighting(
	type: keyof typeof HUB_PREFIX,
	id: string
): SourceSighting | undefined {
	if (!HUB_REPO_ID.test(id)) return undefined;
	return {
		url: `${HUB}/${HUB_PREFIX[type]}${id}`,
		group: id,
		kind: "hub",
		opened: true,
	};
}

/** the reads of one call merged by url, a read beats a search hit and the first title wins */
function mergeSightings(sightings: readonly SourceSighting[]) {
	const byUrl = new Map<string, SourceSighting & { count: number }>();
	for (const sighting of sightings) {
		const seen = byUrl.get(sighting.url);
		if (!seen) {
			byUrl.set(sighting.url, { ...sighting, count: 1 });
			continue;
		}
		seen.count += 1;
		seen.opened ||= sighting.opened;
		seen.title ??= sighting.title;
	}
	return [...byUrl.values()];
}

/** one round trip per call, the unique index on the url makes a racing upsert retry rather than duplicate */
export async function recordSources(
	conversationId: ObjectId,
	readBy: string,
	sightings: readonly SourceSighting[]
): Promise<void> {
	const merged = mergeSightings(sightings);
	if (merged.length === 0) return;
	const now = new Date();
	await collections.mlSources.bulkWrite(
		merged.map(({ url, group, kind, title, opened, count }) => ({
			updateOne: {
				filter: { conversationId, url },
				update: {
					// opened and openedBy are written by exactly one of the two, a search hit never unsets a read
					$setOnInsert: {
						group,
						kind,
						firstSeenAt: now,
						...(opened ? {} : { opened: false, openedBy: [] }),
					},
					$set: {
						lastSeenAt: now,
						...(opened ? { opened: true } : {}),
						...(title ? { title } : {}),
					},
					$addToSet: opened ? { readBy, openedBy: readBy } : { readBy },
					$inc: { count },
				},
				upsert: true,
			},
		})),
		{ ordered: false }
	);
}

export function listMlSources(conversationId: ObjectId): Promise<MlSource[]> {
	return collections.mlSources.find({ conversationId }).sort({ firstSeenAt: 1, _id: 1 }).toArray();
}

export function countSourcesReadBy(conversationId: ObjectId, readBy: string): Promise<number> {
	return collections.mlSources.countDocuments({ conversationId, readBy });
}
