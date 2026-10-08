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

const isImageRef = (block: unknown): block is ToolImageRef => {
	if (typeof block !== "object" || block === null) return false;
	const obj = block as Record<string, unknown>;
	return obj.type === "image" && typeof obj.sha === "string" && typeof obj.mimeType === "string";
};

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
	for (const output of successOutputs(messages)) {
		const content = await offloadImageBlocks(conversationId, output.content);
		if (content === output.content) continue;
		output.content = content;
		changed += 1;
	}
	return changed;
}

const successOutputs = (messages: Message[]) =>
	messages.flatMap((message) =>
		(message.updates ?? []).flatMap((update) =>
			update.type === MessageUpdateType.Tool &&
			update.subtype === MessageToolUpdateType.Result &&
			update.result.status === ToolResultStatus.Success
				? update.result.outputs
				: []
		)
	);

async function readBucketFile(filename: string): Promise<Buffer | null> {
	const file = await collections.bucket.find({ filename }).limit(1).next();
	if (!file) return null;
	const chunks: Buffer[] = [];
	for await (const chunk of collections.bucket.openDownloadStream(file._id)) {
		chunks.push(chunk as Buffer);
	}
	return Buffer.concat(chunks);
}

/** every image the messages reference by sha, read back so a trace stands on its own */
export async function readReferencedToolImages(
	conversationId: ObjectId | string,
	messages: Message[]
): Promise<Array<ToolImageRef & { data: string | null }>> {
	const refs = new Map<string, ToolImageRef>();
	for (const output of successOutputs(messages)) {
		if (!Array.isArray(output.content)) continue;
		for (const block of output.content) if (isImageRef(block)) refs.set(block.sha, block);
	}
	return Promise.all(
		[...refs.values()].map(async (ref) => {
			const bytes = await readBucketFile(`${conversationId.toString()}-${ref.sha}`);
			return { ...ref, data: bytes ? bytes.toString("base64") : null };
		})
	);
}

/** uploads and tool images alike, a share keeps its own copies under the share id */
export async function deleteStoredFilesOf(conversationIds: ObjectId[]): Promise<void> {
	if (conversationIds.length === 0) return;
	const files = await collections.bucket
		.find({ filename: { $in: conversationIds.map((id) => new RegExp(`^${id.toString()}-`)) } })
		.toArray();
	await Promise.all(files.map((file) => collections.bucket.delete(file._id)));
}
