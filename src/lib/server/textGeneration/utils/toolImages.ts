import type { OpenAI } from "openai";
import type { ObjectId } from "mongodb";
import type { MessageFile } from "$lib/types/Message";
import type { makeImageProcessor } from "$lib/server/endpoints/images";
import { downloadFile } from "$lib/server/files/downloadFile";
import { logger } from "$lib/server/logger";

type ChatMessageParam = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type ImagePart = OpenAI.Chat.Completions.ChatCompletionContentPartImage;
type TextPart = OpenAI.Chat.Completions.ChatCompletionContentPartText;
type UserMessage = OpenAI.Chat.Completions.ChatCompletionUserMessageParam;

/** how many tool images replay sends again, newest first, older ones are only named */
export const REPLAYED_TOOL_IMAGES = 4;

/** a tool message takes text only, so the images follow the results in a user message opened by this */
export const TOOL_IMAGES_HEADER =
	"[Images returned by the tool calls above. They come from the tools, not from the user.]";

/** inline data or a gridfs sha */
export type ToolImageBlock = { mimeType: string; data?: string; sha?: string };

export type ToolImageSource = { toolCallId: string; tool: string; blocks: ToolImageBlock[] };

export type ResolvedToolImage =
	| { part: ImagePart }
	/** hidden when images are not passed here, failed when unreadable, dropped when past the replay limit */
	| { missing: "hidden" | "failed" | "dropped" };

export type ToolImageReader = (block: ToolImageBlock) => Promise<MessageFile | undefined>;

export function toolImageBlocks(content: unknown): ToolImageBlock[] {
	if (!Array.isArray(content)) return [];
	return content.flatMap((block): ToolImageBlock[] => {
		if (typeof block !== "object" || block === null) return [];
		const { type, mimeType, data, sha } = block as Record<string, unknown>;
		if (type !== "image" || typeof mimeType !== "string" || !mimeType.startsWith("image/")) {
			return [];
		}
		if (typeof data === "string" && data.length > 0) return [{ mimeType, data }];
		if (typeof sha === "string" && sha.length > 0) return [{ mimeType, sha }];
		return [];
	});
}

/** inline data as is, a sha from the conversation files in gridfs */
export function makeToolImageReader(conversationId?: ObjectId): ToolImageReader {
	return async (block) => {
		if (block.data) {
			return { type: "base64", name: "tool-image", value: block.data, mime: block.mimeType };
		}
		if (!block.sha || !conversationId) return undefined;
		try {
			const file = await downloadFile(block.sha, conversationId);
			return { ...file, mime: block.mimeType };
		} catch (err) {
			logger.warn({ sha: block.sha, err: String(err) }, "[toolImages] stored image unreadable");
			return undefined;
		}
	};
}

export async function resolveToolImage(
	block: ToolImageBlock,
	opts: {
		multimodal: boolean;
		imageProcessor: ReturnType<typeof makeImageProcessor>;
		read: ToolImageReader;
	}
): Promise<ResolvedToolImage> {
	if (!opts.multimodal) return { missing: "hidden" };
	try {
		const file = await opts.read(block);
		if (!file) return { missing: "failed" };
		const { image, mime } = await opts.imageProcessor(file);
		return {
			part: {
				type: "image_url",
				image_url: { url: `data:${mime};base64,${image.toString("base64")}`, detail: "auto" },
			},
		};
	} catch (err) {
		logger.warn({ mime: block.mimeType, err: String(err) }, "[toolImages] image not shown");
		return { missing: "failed" };
	}
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

// worded from probes, softer wording still drew invented descriptions from kimi k3
function noteFor(missing: "hidden" | "failed" | "dropped", count: number): string {
	const one = count === 1;
	const what = one ? "an image" : plural(count, "image");
	const it = one ? "it" : "them";
	const unseen = `so you do not know what ${one ? "it shows" : "they show"}. Do not describe ${it} or draw conclusions from ${it}; if ${one ? "its" : "their"} contents matter, say you could not view ${it}.`;
	switch (missing) {
		case "hidden":
			return `[This result included ${what} that ${one ? "was" : "were"} not passed to you, ${unseen}]`;
		case "failed":
			return `[This result included ${what} that could not be shown to you, ${unseen}]`;
		case "dropped":
			return `[This result included ${what} no longer shown to you, to keep the request small. Attach ${it} again if you need to look.]`;
	}
}

/** a note per result and the message carrying the shown images, numbered back to their calls */
export function renderToolImages(
	results: { toolCallId: string; tool: string; images: ResolvedToolImage[] }[]
): { notes: Map<string, string>; message?: UserMessage } {
	const notes = new Map<string, string>();
	const parts: Array<TextPart | ImagePart> = [];
	let shown = 0;
	for (const { toolCallId, tool, images } of results) {
		if (images.length === 0) continue;
		const lines: string[] = [];
		const numbers: number[] = [];
		for (const image of images) {
			if (!("part" in image)) continue;
			shown += 1;
			numbers.push(shown);
			parts.push({ type: "text", text: `Image ${shown}, from ${tool} call ${toolCallId}:` });
			parts.push(image.part);
		}
		if (numbers.length > 0) {
			const label =
				numbers.length === 1
					? `Image ${numbers[0]}`
					: `Images ${numbers[0]}–${numbers[numbers.length - 1]}`;
			lines.push(
				`[${label} from this result ${numbers.length === 1 ? "is" : "are"} in the message after these tool results.]`
			);
		}
		for (const missing of ["hidden", "failed", "dropped"] as const) {
			const count = images.filter(
				(image) => "missing" in image && image.missing === missing
			).length;
			if (count > 0) lines.push(noteFor(missing, count));
		}
		notes.set(toolCallId, lines.join("\n"));
	}
	if (parts.length === 0) return { notes };
	return {
		notes,
		message: { role: "user", content: [{ type: "text", text: TOOL_IMAGES_HEADER }, ...parts] },
	};
}

export function withImageNote(output: string, note: string | undefined): string {
	if (!note) return output;
	return output.trim().length > 0 ? `${output}\n\n${note}` : note;
}

/** the round tool results with image notes, then the images when the model can see them */
export async function withToolImages(
	toolMessages: ChatMessageParam[],
	sources: ToolImageSource[],
	opts: {
		multimodal: boolean;
		imageProcessor: ReturnType<typeof makeImageProcessor>;
		read: ToolImageReader;
	}
): Promise<ChatMessageParam[]> {
	if (sources.length === 0) return toolMessages;
	const results = await Promise.all(
		sources.map(async ({ toolCallId, tool, blocks }) => ({
			toolCallId,
			tool,
			images: await Promise.all(blocks.map((block) => resolveToolImage(block, opts))),
		}))
	);
	return annotateToolImages(toolMessages, results);
}

export function annotateToolImages(
	toolMessages: ChatMessageParam[],
	results: { toolCallId: string; tool: string; images: ResolvedToolImage[] }[]
): ChatMessageParam[] {
	const { notes, message } = renderToolImages(results);
	const annotated = toolMessages.map((m) => {
		if (m.role !== "tool" || typeof m.content !== "string") return m;
		const note = notes.get(m.tool_call_id);
		return note ? { ...m, content: withImageNote(m.content, note) } : m;
	});
	return message ? [...annotated, message] : annotated;
}

export function isToolImagesMessage(message: ChatMessageParam | undefined): boolean {
	if (message?.role !== "user" || !Array.isArray(message.content)) return false;
	const first = message.content[0];
	return first?.type === "text" && first.text === TOOL_IMAGES_HEADER;
}

/** a tool images message is not one the user wrote */
export function lastUserMessageIndex(messages: ChatMessageParam[]): number {
	return messages.findLastIndex(
		(message) => message.role === "user" && !isToolImagesMessage(message)
	);
}

/** newest tool images first after user attachments, the newest always goes, older ones become a cut note */
export function limitToolImages(
	messages: ChatMessageParam[],
	{ maxImages, maxBytes }: { maxImages: number; maxBytes: number }
): ChatMessageParam[] {
	let count = 0;
	let bytes = 0;
	for (const message of messages) {
		if (message.role !== "user" || isToolImagesMessage(message) || !Array.isArray(message.content))
			continue;
		for (const part of message.content) {
			if (part.type !== "image_url") continue;
			count += 1;
			bytes += part.image_url.url.length;
		}
	}
	let keptAny = false;
	let out: ChatMessageParam[] | undefined;
	for (let i = messages.length - 1; i >= 0; i -= 1) {
		const message = messages[i];
		if (message.role !== "user" || !isToolImagesMessage(message)) continue;
		if (!Array.isArray(message.content)) continue;
		const parts = [...message.content];
		let cut = false;
		for (let p = parts.length - 1; p >= 0; p -= 1) {
			const part = parts[p];
			if (part.type !== "image_url") continue;
			const size = part.image_url.url.length;
			if (!keptAny || (count < maxImages && bytes + size <= maxBytes)) {
				keptAny = true;
				count += 1;
				bytes += size;
				continue;
			}
			const label = parts[p - 1];
			const labelled = label?.type === "text" && label.text !== TOOL_IMAGES_HEADER;
			const name = labelled ? label.text.replace(/:$/, "") : "An earlier tool image";
			const text = `[${name} is no longer attached, to keep the request small. Attach it again if you need to look.]`;
			parts.splice(labelled ? p - 1 : p, labelled ? 2 : 1, { type: "text", text });
			cut = true;
		}
		if (!cut) continue;
		out ??= [...messages];
		out[i] = { ...message, content: parts };
	}
	return out ?? messages;
}
