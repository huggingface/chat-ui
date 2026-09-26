import type { OpenAI } from "openai";
import type { MessageFile } from "$lib/types/Message";
import type { Conversation } from "$lib/types/Conversation";
import { MessageUpdateType, type MessageNoticeUpdate } from "$lib/types/MessageUpdate";
import type { EndpointMessage } from "$lib/server/endpoints/endpoints";
import type { makeImageProcessor } from "$lib/server/endpoints/images";
import { TEXT_MIME_ALLOWLIST } from "$lib/constants/mime";
import { CHARS_PER_TOKEN } from "./historyWindow";
import { stripLoneSurrogates } from "./loneSurrogates";

type ImagePart = OpenAI.Chat.Completions.ChatCompletionContentPartImage;
type TextPart = OpenAI.Chat.Completions.ChatCompletionContentPartText;

/** about 50k tokens of one file, sent as head and tail */
export const FILE_TEXT_BUDGET_CHARS = 50_000 * CHARS_PER_TOKEN;

/** share of the usable window all attachment text of one request may take */
export const ATTACHMENT_WINDOW_SHARE = 0.25;

/** what an older file keeps once a request is over its share, and every file on the retry */
export const SHORT_HEAD_CHARS = 5_000;

export const MAX_IMAGES = 8;

/** base64 image data per request, the 413s came from 13 to 38 images in one request */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export const CLIPBOARD_MIME = "application/vnd.chatui.clipboard";

/** budget is the normal request, minimal is the one retry after the provider refused the size */
export type AttachmentMode = "budget" | "minimal";

export type AttachmentReport = {
	/** index of the newest user message, the one whose files are never shrunk by the request budget */
	newest: number;
	texts: { index: number; name: string; total: number; shown: number }[];
	images: { index: number; name: string; sent: boolean }[];
};

type Keep = { head: number; tail: number };

type TextAttachment = {
	index: number;
	name: string;
	mime: string;
	text: string;
	paste: boolean;
};

type ImageAttachment = { index: number; file: MessageFile };

const formatCount = (n: number) => n.toLocaleString("en-US");

export function truncationMarker(
	shown: number,
	total: number,
	name: string,
	mlAssistant: boolean
): string {
	const rest = mlAssistant
		? "Ask for a specific part, or load the file in a job or sandbox for the rest."
		: "Ask for a specific part if you need the rest.";
	return `[… truncated: showing ${formatCount(shown)} of ${formatCount(total)} characters of ${name}. ${rest}]`;
}

/** a line boundary unless that throws away more than half of what the budget allows */
function headEnd(text: string, budget: number): number {
	const newline = text.lastIndexOf("\n", budget);
	return newline >= budget / 2 ? newline : budget;
}

function tailStart(text: string, budget: number): number {
	const from = text.length - budget;
	const newline = text.indexOf("\n", from - 1);
	return newline !== -1 && newline + 1 - from <= budget / 2 ? newline + 1 : from;
}

/** the same text and keep always give the same output, the prefix cache depends on it */
export function truncateText(
	text: string,
	name: string,
	keep: Keep,
	mlAssistant: boolean
): { text: string; shown: number } {
	if (text.length <= keep.head + keep.tail) return { text, shown: text.length };
	const head = stripLoneSurrogates(text.slice(0, headEnd(text, keep.head)));
	const tail = keep.tail > 0 ? stripLoneSurrogates(text.slice(tailStart(text, keep.tail))) : "";
	const shown = head.length + tail.length;
	const marker = truncationMarker(shown, text.length, name, mlAssistant);
	return { text: [head, marker, tail].filter(Boolean).join("\n"), shown };
}

function isTextMime(mime: string): boolean {
	const [fileType, fileSubtype] = (mime || "").toLowerCase().split("/");
	return TEXT_MIME_ALLOWLIST.some((allowed) => {
		const [type, subtype] = allowed.toLowerCase().split("/");
		return (type === "*" || type === fileType) && (subtype === "*" || subtype === fileSubtype);
	});
}

function collect(messages: EndpointMessage[]) {
	const texts: TextAttachment[] = [];
	const images: ImageAttachment[] = [];
	messages.forEach((message, index) => {
		if (message.from !== "user") return;
		for (const file of message.files ?? []) {
			const paste = file.mime === CLIPBOARD_MIME;
			if (paste || isTextMime(file.mime)) {
				const text = Buffer.from(file.value, "base64").toString("utf-8");
				texts.push({ index, name: file.name, mime: file.mime, text, paste });
			} else if (file.mime.startsWith("image/")) {
				images.push({ index, file });
			}
		}
	});
	return { texts, images };
}

/** bounds the marker, whose length varies with its counts and the file name */
const MARKER_CHARS = 250;

function keptChars(text: string, keep: Keep): number {
	return text.length <= keep.head + keep.tail ? text.length : keep.head + keep.tail + MARKER_CHARS;
}

const renderedChars = (shown: number, total: number) =>
	shown < total ? shown + MARKER_CHARS : total;

/** each file holds one of two sizes, so a later message moves an earlier one at most once */
function planText(
	texts: TextAttachment[],
	opts: { newest: number; limitChars?: number; mode: AttachmentMode }
): Keep[] {
	const requestChars =
		opts.limitChars !== undefined
			? Math.floor(opts.limitChars * ATTACHMENT_WINDOW_SHARE)
			: undefined;
	const perFile = Math.min(FILE_TEXT_BUDGET_CHARS, requestChars ?? FILE_TEXT_BUDGET_CHARS);
	const short: Keep = { head: Math.min(SHORT_HEAD_CHARS, perFile), tail: 0 };
	if (opts.mode === "minimal") return texts.map(() => short);

	const full: Keep = { head: Math.ceil((perFile * 2) / 3), tail: Math.floor(perFile / 3) };
	const keeps = texts.map(() => full);
	if (requestChars === undefined) return keeps;
	let total = texts.reduce((sum, t, i) => sum + keptChars(t.text, keeps[i]), 0);
	for (const [i, t] of texts.entries()) {
		if (total <= requestChars) break;
		if (t.index === opts.newest) continue;
		total -= keptChars(t.text, keeps[i]) - keptChars(t.text, short);
		keeps[i] = short;
	}
	return keeps;
}

/** the most recent few, newest first against the byte cap, the newest image always goes */
async function planImages(
	images: ImageAttachment[],
	imageProcessor: ReturnType<typeof makeImageProcessor>,
	opts: { newest: number; mode: AttachmentMode }
): Promise<Map<MessageFile, ImagePart>> {
	const pool = opts.mode === "minimal" ? images.filter((i) => i.index === opts.newest) : images;
	const picked = pool.slice(-MAX_IMAGES);
	const processed = await Promise.all(picked.map(({ file }) => imageProcessor(file)));
	const sent = new Map<MessageFile, ImagePart>();
	let bytes = 0;
	for (let i = picked.length - 1; i >= 0; i -= 1) {
		const url = `data:${processed[i].mime};base64,${processed[i].image.toString("base64")}`;
		if (sent.size > 0 && bytes + url.length > MAX_IMAGE_BYTES) break;
		bytes += url.length;
		sent.set(picked[i].file, { type: "image_url", image_url: { url, detail: "auto" } });
	}
	return sent;
}

type UserContent = string | Array<TextPart | ImagePart>;

/** budgeted across the whole history so a stored message renders the same text on every request */
export async function prepareAttachments(
	messages: EndpointMessage[],
	imageProcessor: ReturnType<typeof makeImageProcessor>,
	isMultimodal: boolean,
	opts: { limitChars?: number; mode?: AttachmentMode; mlAssistant?: boolean }
): Promise<{ contentOf: (index: number) => UserContent; report: AttachmentReport }> {
	const mode = opts.mode ?? "budget";
	const newest = messages.findLastIndex((message) => message.from === "user");
	const { texts, images } = collect(messages);
	const keeps = planText(texts, { newest, limitChars: opts.limitChars, mode });
	const rendered = texts.map((t, i) =>
		truncateText(t.text, t.name, keeps[i], opts.mlAssistant ?? false)
	);
	const sent = isMultimodal
		? await planImages(images, imageProcessor, { newest, mode })
		: new Map<MessageFile, ImagePart>();

	const report: AttachmentReport = {
		newest,
		texts: texts.map((t, i) => ({
			index: t.index,
			name: t.name,
			total: t.text.length,
			shown: rendered[i].shown,
		})),
		images: isMultimodal
			? images.map(({ index, file }) => ({ index, name: file.name, sent: sent.has(file) }))
			: [],
	};

	const contentOf = (index: number): UserContent => {
		const message = messages[index];
		const own = texts.flatMap((t, i) => (t.index === index ? [{ t, text: rendered[i].text }] : []));
		const documents = own
			.filter(({ t }) => !t.paste)
			.map(({ t, text }) => `<document name="${t.name}" type="${t.mime}">\n${text}\n</document>`);
		const pastes = own.filter(({ t }) => t.paste).map(({ text }) => text);
		let text = message.content;
		if (pastes.length > 0) text = `${pastes.join("\n\n")}\n\n${text}`;
		if (documents.length > 0) text = `${documents.join("\n\n")}\n\n${text}`;
		if (!isMultimodal) return text;
		const ownImages = images.filter((image) => image.index === index);
		const omitted = ownImages.filter(({ file }) => !sent.has(file));
		if (omitted.length > 0) {
			text += `\n\n${omitted.map(({ file }) => `[image omitted: ${file.name}]`).join("\n")}`;
		}
		const parts = ownImages.flatMap(({ file }) => sent.get(file) ?? []);
		return parts.length > 0 ? [{ type: "text", text }, ...parts] : text;
	};

	return { contentOf, report };
}

/** whether the minimal retry would send less than this request did, marker included */
export function canCutAttachments(report: AttachmentReport): boolean {
	return (
		report.texts.some(
			(t) =>
				renderedChars(t.shown, t.total) >
				renderedChars(Math.min(t.shown, SHORT_HEAD_CHARS), t.total)
		) || report.images.some((i) => i.sent && i.index !== report.newest)
	);
}

const CONTEXT_OVERFLOW =
	/maximum context length|context[ _-]length[ _-]exceeded|context window|prompt is too long|too many (?:input )?tokens|request entity too large/i;

/** a provider refusing the request for its size, the only failure cutting attachments can fix */
export function isContextOverflowError(err: unknown): boolean {
	if (typeof err !== "object" || err === null) return false;
	const { status, statusCode, message } = err as {
		status?: unknown;
		statusCode?: unknown;
		message?: unknown;
	};
	if (status === 413 || statusCode === 413) return true;
	return typeof message === "string" && CONTEXT_OVERFLOW.test(message);
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

const listNames = (names: string[]) =>
	names.length <= 3
		? names.join(", ")
		: `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`;

/** what the user is told when a file in the message just sent did not go whole */
export function budgetNotice(report: AttachmentReport): string | undefined {
	const cut = report.texts.filter((t) => t.index === report.newest && t.shown < t.total);
	const omitted = report.images.filter((i) => i.index === report.newest && !i.sent);
	const lines = cut.map(
		(t) =>
			`${t.name} is too long to send whole: the model sees ${formatCount(t.shown)} of its ${formatCount(t.total)} characters, from the start and the end.`
	);
	if (omitted.length > 0) {
		lines.push(
			`${plural(omitted.length, "image")} left out to keep the request within limits: ${listNames(omitted.map((i) => i.name))}.`
		);
	}
	return lines.length > 0 ? lines.join(" ") : undefined;
}

/** what the user is told when the retry went through, from the report of the retry itself */
export function retryNotice(report: AttachmentReport): string {
	const cut = report.texts
		.filter((t) => t.shown < t.total)
		.map(
			(t) => `${t.name} to its first ${formatCount(t.shown)} of ${formatCount(t.total)} characters`
		);
	const omitted = report.images.filter((i) => !i.sent).length;
	const parts = [...cut, ...(omitted > 0 ? [`${plural(omitted, "image")} left out`] : [])];
	return `The model refused the request as too large, so it was sent again with attachments cut: ${parts.join("; ")}.`;
}

/** a resumed or continued turn builds the same notice again, the message keeps one */
export function noticeFor(
	conv: Pick<Conversation, "messages">,
	messageId: string | undefined,
	text: string | undefined
): MessageNoticeUpdate | undefined {
	if (!text) return undefined;
	const message = messageId ? conv.messages.find((m) => m.id === messageId) : undefined;
	const shown = message?.updates?.some(
		(u) => u.type === MessageUpdateType.Notice && u.text === text
	);
	return shown ? undefined : { type: MessageUpdateType.Notice, text };
}

/** the error the turn ends with when even the retry was too large, naming what is attached */
export class AttachmentOverflowError extends Error {
	readonly status?: number;

	constructor(report: AttachmentReport, cause: unknown) {
		const texts = [...report.texts]
			.sort((a, b) => b.total - a.total)
			.map((t) => `${t.name} (${formatCount(t.total)} characters)`);
		const sentImages = report.images.filter((i) => i.sent).length;
		const named = [...texts, ...(sentImages > 0 ? [plural(sentImages, "image")] : [])];
		super(
			`This conversation is too large for the model, even with its attachments cut down: ${listNames(named)}. ` +
				"Start a new conversation and attach a smaller part."
		);
		this.name = "AttachmentOverflowError";
		this.cause = cause;
		const { status, statusCode } = (cause ?? {}) as { status?: unknown; statusCode?: unknown };
		const code = typeof status === "number" ? status : statusCode;
		if (typeof code === "number") this.status = code;
	}
}
