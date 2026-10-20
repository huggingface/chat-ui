import type {
	ReviewAnswer,
	ReviewDraft,
	ReviewDraftStatus,
	ReviewQuestion,
	ReviewQuote,
	ReviewSchema,
	ReviewSuggestionsMode,
} from "$lib/types/MlReview";
import { isAnswered } from "./answers";

/** long enough to see the pick land before the record changes */
export const AUTO_ADVANCE_MS = 250;

/** what the comment anchor keeps on each side of the selection */
export const QUOTE_CONTEXT_CHARS = 32;
/** the draft endpoint refuses a longer quote */
export const QUOTE_MAX_CHARS = 2_000;

/** a skip or discard stands until the user answers again */
export function draftStatus(
	schema: Pick<ReviewSchema, "questions">,
	answers: ReviewDraft["answers"],
	previous: ReviewDraftStatus | undefined,
	{ answering }: { answering: boolean }
): ReviewDraftStatus {
	if (!answering && (previous === "skipped" || previous === "discarded")) return previous;
	const required = schema.questions.filter((question) => question.required);
	const done =
		required.length > 0
			? required.every((question) => isAnswered(answers[question.name]))
			: schema.questions.some((question) => isAnswered(answers[question.name]));
	return done ? "answered" : "pending";
}

export function suggestionVisible(mode: ReviewSuggestionsMode, value: unknown): boolean {
	if (mode === "none") return false;
	if (mode === "after_answer") return isAnswered(value);
	return true;
}

export interface KeyOption {
	value: ReviewAnswer;
	label: string;
}

/** the picks number keys reach, in order, a text question has none */
export function keyOptions(question: ReviewQuestion): KeyOption[] {
	switch (question.type) {
		case "label":
		case "multi_label":
			return question.options.map((option) => ({
				value: option.value,
				label: option.title ?? option.value,
			}));
		case "rating":
			return Array.from({ length: question.max - question.min + 1 }, (_, i) => ({
				value: question.min + i,
				label: String(question.min + i),
			}));
		case "boolean":
			return [
				{ value: true, label: "Yes" },
				{ value: false, label: "No" },
			];
		case "text":
			return [];
	}
}

/** a multi label pick toggles, every other pick replaces */
export function pick(
	question: ReviewQuestion,
	current: unknown,
	value: ReviewAnswer
): ReviewAnswer {
	if (question.type !== "multi_label") return value;
	const list = Array.isArray(current) ? (current as string[]) : [];
	return list.includes(value as string)
		? list.filter((v) => v !== value)
		: [...list, value as string];
}

export function formatAnswer(question: ReviewQuestion, value: unknown): string {
	if (!isAnswered(value)) return "";
	if (question.type === "boolean") return value ? "Yes" : "No";
	const options = keyOptions(question);
	const label = (v: unknown) => options.find((option) => option.value === v)?.label ?? String(v);
	return Array.isArray(value) ? value.map(label).join(", ") : label(value);
}

export function quoteAt(text: string, start: number, end: number): ReviewQuote {
	return {
		exact: text.slice(start, Math.min(end, start + QUOTE_MAX_CHARS)),
		prefix: text.slice(Math.max(0, start - QUOTE_CONTEXT_CHARS), start),
		suffix: text.slice(end, end + QUOTE_CONTEXT_CHARS),
	};
}

const commonSuffix = (a: string, b: string) => {
	let n = 0;
	while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n += 1;
	return n;
};

const commonPrefix = (a: string, b: string) => {
	let n = 0;
	while (n < a.length && n < b.length && a[n] === b[n]) n += 1;
	return n;
};

/** found again by the quote, the context picks between repeats, undefined is an anchor lost */
export function findQuote(
	text: string,
	quote: ReviewQuote
): { start: number; end: number } | undefined {
	if (!quote.exact) return undefined;
	let best: { start: number; score: number } | undefined;
	for (let at = text.indexOf(quote.exact); at !== -1; at = text.indexOf(quote.exact, at + 1)) {
		const score =
			commonSuffix(text.slice(0, at), quote.prefix) +
			commonPrefix(text.slice(at + quote.exact.length), quote.suffix);
		if (!best || score > best.score) best = { start: at, score };
	}
	return best && { start: best.start, end: best.start + quote.exact.length };
}

/** a public resolve url, a private repo image fails to load like any broken link */
export function imageUrl(uri: string): string | undefined {
	if (uri.startsWith("https://")) return uri;
	const match =
		/^hf:\/\/(?:(datasets|spaces|models)\/)?([^/\s@]+\/[^/\s@]+)(?:@([^/\s]+))?\/(.+)$/.exec(uri);
	if (!match) return undefined;
	const [, kind, repo, revision, path] = match;
	const prefix = kind === "datasets" || kind === "spaces" ? `${kind}/` : "";
	return `https://huggingface.co/${prefix}${repo}/resolve/${encodeURIComponent(
		revision ?? "main"
	)}/${path}`;
}

export type DeliveryStatus = "pending" | "sending" | "sent" | "failed";

const DELIVERY_LABEL: Record<DeliveryStatus, string> = {
	pending: "Posts as your message once the current turn ends",
	sending: "Posting as your message",
	sent: "Posted as your message",
	failed: "Could not post this review to the chat",
};

/** a submission the turn had moved past goes out as the user's next message */
export const deliveryLabel = (status: DeliveryStatus): string => DELIVERY_LABEL[status];
