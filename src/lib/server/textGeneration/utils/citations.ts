import type { MessageSource } from "$lib/types/MessageUpdate";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

const URL_REGEX = /https?:\/\/[^\s<]+/g;

const canParseHttpUrl = (value: string): boolean => {
	try {
		const parsed = new URL(value);
		return parsed.protocol === "http:" || parsed.protocol === "https:";
	} catch {
		return false;
	}
};

export function normalizeUrl(raw: string): string {
	if (canParseHttpUrl(raw)) {
		return raw;
	}

	const trimmed = raw.replace(/[)\].,;:"'>]+$/g, "");
	return canParseHttpUrl(trimmed) ? trimmed : raw;
}

const stripTrailingSourcesBlock = (input: string): string => {
	const lines = input.split("\n");
	let headerIndex = -1;
	for (let i = lines.length - 1; i >= 0; i -= 1) {
		const trimmed = lines[i].trim();
		if (!trimmed) continue;
		if (
			/^sources?:\s*$/i.test(trimmed) ||
			/^sources?:\s*(?:\[[\d]+\]\([^)]*\)|\(?\s*\d+\)?|https?:\/\/\S+)(?:\s*,\s*(?:\[[\d]+\]\([^)]*\)|\(?\s*\d+\)?|https?:\/\/\S+))*$/i.test(
				trimmed
			)
		) {
			headerIndex = i;
			break;
		}
		if (!/^[-*]?\s*(?:\(?\s*\d+\)?\.?\s*)?(https?:\/\/\S+|\[[\d]+\]\([^)]*\))\s*$/i.test(trimmed)) {
			return input;
		}
	}
	if (headerIndex === -1) return input;
	for (let j = headerIndex + 1; j < lines.length; j += 1) {
		const trimmed = lines[j].trim();
		if (!trimmed) continue;
		if (!/^[-*]?\s*(?:\(?\s*\d+\)?\.?\s*)?(https?:\/\/\S+|\[[\d]+\]\([^)]*\))\s*$/i.test(trimmed)) {
			return input;
		}
	}
	return lines.slice(0, headerIndex).join("\n").replace(/\s+$/, "");
};

// No longer needed: we no longer normalize or remap inline indices.

export type CitationSource = { index: number; link: string };

export class CitationTracker {
	private citationSources: MessageSource[] = [];
	private citationIndex = new Map<string, number>();
	private lastMappingCount = 0;
	private mappingMessageIndex: number | null = null;

	registerSource(rawUrl: string): number | null {
		const normalized = normalizeUrl(rawUrl);
		if (!normalized) return null;
		let current = this.citationIndex.get(normalized);
		if (!current) {
			current = this.citationSources.length + 1;
			this.citationIndex.set(normalized, current);
			this.citationSources.push({ link: normalized, index: current });
		}
		return current;
	}

	collectToolOutputSources(text: string): { annotated: string; sources: CitationSource[] } {
		const matches = text.match(URL_REGEX) ?? [];
		const sources: CitationSource[] = [];
		for (const raw of matches) {
			const index = this.registerSource(raw);
			if (!index) continue;
			const link = this.citationSources[index - 1]?.link;
			if (!link) continue;
			if (!sources.some((entry) => entry.index === index)) {
				sources.push({ index, link });
			}
		}

		return { annotated: text, sources };
	}

	appendMissingCitations(text: string): string {
		if (this.citationSources.length === 0) return text;
		let updated = text;

		updated = updated.replace(
			/\n?Sources:\s*(?:\[[\d]+\]\([^)]*\)|\d+)(?:[\s,\n]+(?:\[[\d]+\]\([^)]*\)|\d+))*$/i,
			""
		);
		updated = stripTrailingSourcesBlock(updated);
		updated = updated.replace(/(^|\n)Tools?\s+used?:.*$/gi, "");
		return updated.trim();
	}

	// Removed: normalizeCitations. We rely on the model to cite correctly
	// using the provided mapping and we surface the collected sources as-is.

	buildMappingMessage(): string | null {
		if (this.citationSources.length === 0) {
			return null;
		}
		const pairs = this.citationSources
			.map((source) => {
				const label = `[${source.index}]`;
				return source.link ? `${label} ${source.link}` : label;
			})
			.filter(Boolean)
			.join("\n");
		if (!pairs) {
			return null;
		}
		return `Use the following source index mapping when citing:\n${pairs}\nReference only these indices (e.g., [1]) and reuse numbers for repeat URLs.`;
	}

	injectMappingMessage(messages: ChatCompletionMessageParam[]): {
		messages: ChatCompletionMessageParam[];
		mappingIndex: number | null;
	} {
		if (
			this.citationSources.length === 0 ||
			this.citationSources.length === this.lastMappingCount
		) {
			return { messages, mappingIndex: this.mappingMessageIndex };
		}
		const mappingMessage = this.buildMappingMessage();
		if (!mappingMessage) {
			return { messages, mappingIndex: this.mappingMessageIndex };
		}
		let updated = messages;
		if (this.mappingMessageIndex !== null && this.mappingMessageIndex >= 0) {
			if (this.mappingMessageIndex < updated.length) {
				const existing = updated[this.mappingMessageIndex];
				if (existing?.role === "system") {
					updated = [
						...updated.slice(0, this.mappingMessageIndex),
						...updated.slice(this.mappingMessageIndex + 1),
					];
				}
			}
			this.mappingMessageIndex = null;
		}
		updated = [...updated, { role: "system", content: mappingMessage }];
		this.mappingMessageIndex = updated.length - 1;
		this.lastMappingCount = this.citationSources.length;
		return { messages: updated, mappingIndex: this.mappingMessageIndex };
	}

	getSources(): MessageSource[] {
		return this.citationSources;
	}
}
