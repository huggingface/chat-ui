import { createHash } from "node:crypto";
import type { ObjectId } from "mongodb";
import { collections } from "$lib/server/database";
import { logger } from "$lib/server/logger";
import type { Message } from "$lib/types/Message";
import { MessageToolUpdateType, MessageUpdateType } from "$lib/types/MessageUpdate";
import { ToolResultStatus } from "$lib/types/Tool";

/** the model never receives these, the tool card is their only reader */
type InlineImageBlock = { type: "image"; data: string; mimeType: string };

export type ToolImageRef = { type: "image"; mimeType: string; sha: string };

const isInlineImage = (block: unknown): block is InlineImageBlock => {
	if (typeof block !== "object" || block === null) return false;
	const obj = block as Record<string, unknown>;
	return obj.type === "image" && typeof obj.data === "string" && typeof obj.mimeType === "string";
};

// parallel attaches of one image would race past the exists check
const inFlight = new Map<string, Promise<void>>();

async function putOnce(filename: string, bytes: Buffer, conversation: string, mime: string) {
	const existing = await collections.bucket.find({ filename }).limit(1).hasNext();
	if (existing) return;
	await new Promise<void>((resolve, reject) => {
		const upload = collections.bucket.openUploadStream(filename, {
			metadata: { conversation, mime },
		});
		upload.once("finish", () => resolve());
		upload.once("error", reject);
		upload.end(bytes);
	});
}

/** named like uploadFile so share copies include these */
export async function storeToolImage(
	conversationId: ObjectId | string,
	block: InlineImageBlock
): Promise<ToolImageRef> {
	const bytes = Buffer.from(block.data, "base64");
	const sha = createHash("sha256").update(bytes).digest("hex");
	const conversation = conversationId.toString();
	const filename = `${conversation}-${sha}`;

	let pending = inFlight.get(filename);
	if (!pending) {
		pending = putOnce(filename, bytes, conversation, block.mimeType).finally(() =>
			inFlight.delete(filename)
		);
		inFlight.set(filename, pending);
	}
	await pending;
	return { type: "image", mimeType: block.mimeType, sha };
}

/** a block that fails to upload stays inline and is retried on the next save */
export async function offloadImageBlocks<T>(
	conversationId: ObjectId | string,
	content: T
): Promise<T> {
	if (!Array.isArray(content) || !content.some(isInlineImage)) return content;
	const blocks = await Promise.all(
		content.map(async (block: unknown) => {
			if (!isInlineImage(block)) return block;
			try {
				return await storeToolImage(conversationId, block);
			} catch (err) {
				logger.warn(
					{ err, conversationId: conversationId.toString() },
					"[files] tool image upload failed"
				);
				return block;
			}
		})
	);
	return blocks.every((block, i) => block === content[i]) ? content : (blocks as T);
}

/**
 * in place, a conversation at the cap takes no further write until its images move out
 * @returns how many outputs changed
 */
export async function offloadStoredToolImages(
	conversationId: ObjectId | string,
	messages: Message[]
): Promise<number> {
	let changed = 0;
	for (const message of messages) {
		for (const update of message.updates ?? []) {
			if (
				update.type !== MessageUpdateType.Tool ||
				update.subtype !== MessageToolUpdateType.Result ||
				update.result.status !== ToolResultStatus.Success
			) {
				continue;
			}
			const { result } = update;
			for (let i = 0; i < result.outputs.length; i += 1) {
				const output = result.outputs[i];
				const content = await offloadImageBlocks(conversationId, output.content);
				if (content === output.content) continue;
				result.outputs[i] = { ...output, content };
				changed += 1;
			}
		}
	}
	return changed;
}
