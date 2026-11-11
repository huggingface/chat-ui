import { createHash } from "node:crypto";
import type { ObjectId } from "mongodb";
import { collections } from "$lib/server/database";
import type { PaperRef } from "$lib/utils/paper";

/**
 * A paper is three kinds of file in the conversation's GridFS bucket, named
 * like any attachment so sharing and forking a conversation carry them along
 * (both copy every `<conversationId>-*` file):
 *
 * - `<conversationId>-<sha>`: the PDF, served to the reader by the existing
 *   `/conversation/[id]/output/[sha]` route;
 * - `<conversationId>-<sha>-text`: its text, one string per page, for
 *   `read_paper` and for checking the quotes users attach;
 * - `<conversationId>-paper-<sha>-<id hash>`: the paper record, one per id the
 *   bytes were opened as.
 *
 * The two content files are shared by every id with the same bytes (a mirror
 * URL and the arXiv id, say), so the record is kept apart from them: writing
 * the bytes again is skipped, but each id still gets found. Records are looked
 * up by id rather than read off the messages, so a paper opened earlier in the
 * same turn — not yet on any stored message — is found too.
 */

type ConversationKey = ObjectId | string;

interface PaperFileMetadata {
	conversation: string;
	mime: string;
	paper?: Omit<PaperRef, "messageId">;
}

async function readFile(filename: string): Promise<Buffer | null> {
	const file = await collections.bucket.find({ filename }).limit(1).next();
	if (!file) return null;
	const stream = collections.bucket.openDownloadStream(file._id);
	return new Promise<Buffer>((resolve, reject) => {
		const chunks: Uint8Array[] = [];
		stream.on("data", (chunk) => chunks.push(chunk));
		stream.on("error", reject);
		stream.on("end", () => resolve(Buffer.concat(chunks)));
	});
}

async function writeFile(filename: string, data: Buffer, metadata: PaperFileMetadata) {
	const existing = await collections.bucket.find({ filename }).limit(1).next();
	if (existing) return;
	const upload = collections.bucket.openUploadStream(filename, { metadata });
	await new Promise<void>((resolve, reject) => {
		upload.once("finish", () => resolve());
		upload.once("error", reject);
		upload.end(data);
	});
}

export async function savePaper(
	conversationId: ConversationKey,
	pdf: Uint8Array,
	pages: string[],
	paper: Omit<PaperRef, "messageId">
): Promise<void> {
	const conversation = conversationId.toString();
	await writeFile(`${conversation}-${paper.sha}-text`, Buffer.from(JSON.stringify({ pages })), {
		conversation,
		mime: "application/json",
	});
	await writeFile(`${conversation}-${paper.sha}`, Buffer.from(pdf), {
		conversation,
		mime: "application/pdf",
	});
	const idKey = createHash("sha256").update(paper.id).digest("hex").slice(0, 16);
	await writeFile(
		`${conversation}-paper-${paper.sha}-${idKey}`,
		Buffer.from(JSON.stringify(paper)),
		{ conversation, mime: "application/json", paper }
	);
	remember(conversation, paper.sha, pages);
}

/** The most recently stored version of a paper in this conversation. */
export async function findStoredPaper(
	conversationId: ConversationKey,
	paperId: string
): Promise<Omit<PaperRef, "messageId"> | null> {
	const file = await collections.bucket
		.find({
			"metadata.conversation": conversationId.toString(),
			"metadata.paper.id": paperId,
		})
		.sort({ uploadDate: -1 })
		.limit(1)
		.next();
	const paper = (file?.metadata as PaperFileMetadata | undefined)?.paper;
	return paper ?? null;
}

const CACHE_LIMIT = 24;
const cache = new Map<string, string[]>();

function remember(conversation: string, sha: string, pages: string[]) {
	const key = `${conversation}-${sha}`;
	cache.delete(key);
	cache.set(key, pages);
	for (const old of cache.keys()) {
		if (cache.size <= CACHE_LIMIT) break;
		cache.delete(old);
	}
}

export async function loadPaperPages(
	conversationId: ConversationKey,
	sha: string
): Promise<string[] | null> {
	const conversation = conversationId.toString();
	const cached = cache.get(`${conversation}-${sha}`);
	if (cached) return cached;
	const raw = await readFile(`${conversation}-${sha}-text`);
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw.toString("utf8")) as { pages?: unknown };
		if (!Array.isArray(parsed.pages)) return null;
		const pages = parsed.pages.map((p) => (typeof p === "string" ? p : ""));
		remember(conversation, sha, pages);
		return pages;
	} catch {
		return null;
	}
}
