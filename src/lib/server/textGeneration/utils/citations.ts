import type { MessageSource } from "$lib/types/MessageUpdate";
import { canonicalizeUrl, extractUrlMatches, type UrlMatch } from "./url";

export type CitationSource = { index: number; link: string };

const annotateMatches = (
	text: string,
	matches: UrlMatch[],
	lookupIndex: (canonical: string) => number | null
): { annotated: string; indices: number[] } => {
	if (matches.length === 0) {
		return { annotated: text, indices: [] };
	}

	let cursor = 0;
	let annotated = "";
	const seenInText = new Set<number>();

	for (const match of matches) {
		annotated += text.slice(cursor, match.index);
		annotated += text.slice(match.index, match.lastIndex);
		cursor = match.lastIndex;

		const canonical = canonicalizeUrl(match.url);
		if (!canonical) continue;
		const index = lookupIndex(canonical);
		if (!index) continue;

		if (!seenInText.has(index)) {
			const following = text.slice(match.lastIndex, match.lastIndex + 10);
			if (!/^\s*\[\d+(?:\s*,\s*\d+)*\]/.test(following)) {
				annotated += ` [${index}]`;
			}
			seenInText.add(index);
		}
	}

	annotated += text.slice(cursor);
	return { annotated, indices: Array.from(seenInText) };
};

export class CitationTracker {
	private citationSources: MessageSource[] = [];
	private citationIndex = new Map<string, number>();

	private register(canonical: string): number {
		const existing = this.citationIndex.get(canonical);
		if (existing) return existing;
		const index = this.citationSources.length + 1;
		this.citationIndex.set(canonical, index);
		this.citationSources.push({ link: canonical, index });
		return index;
	}

	private ensureIndex(raw: string): number | null {
		const canonical = canonicalizeUrl(raw);
		if (!canonical) return null;
		return this.register(canonical);
	}

	process(text: string, { annotate = true }: { annotate?: boolean } = {}): {
		annotated: string;
		sources: CitationSource[];
	} {
		if (typeof text !== "string" || text.length === 0) {
			return { annotated: text, sources: [] };
		}

		const matches = extractUrlMatches(text);
		if (matches.length === 0) {
			return { annotated: text, sources: [] };
		}

		const indicesReferenced = new Set<number>();
		const lookupIndex = (canonical: string): number | null => {
			const index = this.ensureIndex(canonical);
			if (!index) return null;
			indicesReferenced.add(index);
			return index;
		};

		if (!annotate) {
			for (const match of matches) {
				const canonical = canonicalizeUrl(match.url);
				if (!canonical) continue;
				lookupIndex(canonical);
			}
			return {
				annotated: text,
				sources: Array.from(indicesReferenced)
					.sort((a, b) => a - b)
					.map((index) => this.citationSources[index - 1]!) ?? [],
			};
		}

		const { annotated, indices } = annotateMatches(text, matches, lookupIndex);
		return {
			annotated,
			sources: indices
				.sort((a, b) => a - b)
				.map((index) => this.citationSources[index - 1]!) ?? [],
		};
	}

	sources(): MessageSource[] {
		return this.citationSources.slice();
	}
}
