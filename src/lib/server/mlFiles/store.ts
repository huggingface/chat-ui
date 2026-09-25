import { createHash } from "crypto";
import type { ObjectId } from "mongodb";
import { MongoServerError } from "mongodb";
import { collections } from "$lib/server/database";
import type { MlFile } from "$lib/types/MlFile";

/**
 * mongodb is canonical, nothing is pushed anywhere unless the model passes a reference
 * to a hub or sandbox tool
 */

/** per version, scripts and configs fit and anything larger is data */
export const ML_FILE_MAX_BYTES = 256 * 1024;
export const ML_FILE_MAX_NAME_CHARS = 200;
const ML_FILE_MAX_SUMMARY_CHARS = 200;

const NAME_CHARS = /^[A-Za-z0-9._/-]+$/;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
/** mongo duplicate key error code */
const DUPLICATE_KEY = 11000;

export type Validated<T> = { ok: true; value: T } | { ok: false; error: string };

export function validateMlFileName(name: unknown): Validated<string> {
	if (typeof name !== "string" || name.trim().length === 0) {
		return { ok: false, error: "A file needs a name, e.g. train.py or configs/sft.yaml." };
	}
	const trimmed = name.trim();
	if (trimmed.length > ML_FILE_MAX_NAME_CHARS) {
		return { ok: false, error: `File names are at most ${ML_FILE_MAX_NAME_CHARS} characters.` };
	}
	if (!NAME_CHARS.test(trimmed)) {
		return {
			ok: false,
			error: `"${trimmed}" is not a valid file name: use letters, digits, ".", "_", "-" and "/" only.`,
		};
	}
	if (trimmed.startsWith("/")) {
		return { ok: false, error: `"${trimmed}" must be a relative path, without a leading "/".` };
	}
	const segments = trimmed.split("/");
	if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
		return {
			ok: false,
			error: `"${trimmed}" is not a valid file name: no empty, "." or ".." path segments.`,
		};
	}
	return { ok: true, value: trimmed };
}

export function validateMlFileContent(content: unknown): Validated<string> {
	if (typeof content !== "string") return { ok: false, error: "File content must be a string." };
	if (content.includes("\u0000") || LONE_SURROGATE.test(content)) {
		return {
			ok: false,
			error: "Virtual files are text only: the content has NUL bytes or is not valid UTF-8.",
		};
	}
	const size = Buffer.byteLength(content, "utf8");
	if (size > ML_FILE_MAX_BYTES) {
		return {
			ok: false,
			error: `The content is ${size.toLocaleString("en-US")} bytes; a virtual file is at most ${
				ML_FILE_MAX_BYTES / 1024
			} KB per version. Split it, or keep data out of the script and load it from the Hub.`,
		};
	}
	return { ok: true, value: content };
}

export interface MlFileAttribution {
	messageId?: string;
	generationId?: string;
	toolUuid?: string;
	agent?: string;
}

export interface WrittenMlFile {
	name: string;
	version: number;
	size: number;
	lineCount: number;
	sha256: string;
}

export function countLines(content: string): number {
	if (content.length === 0) return 0;
	return content.split("\n").length - (content.endsWith("\n") ? 1 : 0);
}

const trimSummary = (summary: unknown): string | undefined => {
	if (typeof summary !== "string") return undefined;
	const trimmed = summary.trim().split("\n")[0];
	if (!trimmed) return undefined;
	return trimmed.length > ML_FILE_MAX_SUMMARY_CHARS
		? `${trimmed.slice(0, ML_FILE_MAX_SUMMARY_CHARS - 1)}…`
		: trimmed;
};

export interface MlFileVersionConflict {
	conflict: true;
	latestVersion: number;
}

interface WriteMlFileParams {
	conversationId: ObjectId;
	name: string;
	content: string;
	origin: MlFile["origin"];
	source?: string;
	summary?: string;
	attribution?: MlFileAttribution;
}

async function latestMlFileVersion(conversationId: ObjectId, name: string): Promise<number> {
	const latest = await collections.mlFiles.findOne(
		{ conversationId, name },
		{ sort: { version: -1 }, projection: { version: 1 } }
	);
	return latest?.version ?? 0;
}

/** appends a version, name and content are validated by the caller so a refusal names the argument */
export function writeMlFileVersion(params: WriteMlFileParams): Promise<WrittenMlFile>;
/**
 * with baseVersion the new version is baseVersion + 1 or nothing, the unique index
 * is what makes an edit derived from one version unable to land on top of another
 */
export function writeMlFileVersion(
	params: WriteMlFileParams & { baseVersion: number }
): Promise<WrittenMlFile | MlFileVersionConflict>;
export async function writeMlFileVersion(
	params: WriteMlFileParams & { baseVersion?: number }
): Promise<WrittenMlFile | MlFileVersionConflict> {
	const { conversationId, name, content, origin, baseVersion } = params;
	const size = Buffer.byteLength(content, "utf8");
	const sha256 = createHash("sha256").update(content).digest("hex");
	const summary = trimSummary(params.summary);
	// parallel calls in one round can write the same name, an unpinned write retries on
	// the next number and a pinned one reports the conflict
	for (let attempt = 0; ; attempt += 1) {
		const version =
			baseVersion !== undefined
				? baseVersion + 1
				: (await latestMlFileVersion(conversationId, name)) + 1;
		try {
			await collections.mlFiles.insertOne({
				conversationId,
				name,
				version,
				content,
				size,
				sha256,
				origin,
				...(params.source ? { source: params.source } : {}),
				createdAt: new Date(),
				...(params.attribution?.messageId ? { messageId: params.attribution.messageId } : {}),
				...(params.attribution?.generationId
					? { generationId: params.attribution.generationId }
					: {}),
				...(params.attribution?.toolUuid ? { toolUuid: params.attribution.toolUuid } : {}),
				...(params.attribution?.agent ? { agent: params.attribution.agent } : {}),
				...(summary ? { summary } : {}),
			} as MlFile);
			return { name, version, size, lineCount: countLines(content), sha256 };
		} catch (err) {
			const duplicate = err instanceof MongoServerError && err.code === DUPLICATE_KEY;
			if (!duplicate) throw err;
			if (baseVersion !== undefined) {
				return {
					conflict: true,
					latestVersion: await latestMlFileVersion(conversationId, name),
				};
			}
			if (attempt >= 2) throw err;
		}
	}
}

/** a conversation owns its files, so every path that deletes one calls this */
export async function deleteMlFilesOf(conversationIds: ObjectId[]): Promise<void> {
	if (conversationIds.length === 0) return;
	await collections.mlFiles.deleteMany({ conversationId: { $in: conversationIds } });
}

export async function readMlFile(
	conversationId: ObjectId,
	name: string,
	version?: number
): Promise<MlFile | null> {
	if (version !== undefined) {
		return collections.mlFiles.findOne({ conversationId, name, version });
	}
	return collections.mlFiles.findOne({ conversationId, name }, { sort: { version: -1 } });
}

export interface MlFileListing {
	name: string;
	/** the latest version, also how many exist */
	version: number;
	size: number;
	updatedAt: Date;
	summary?: string;
}

/** the latest version of every file by name, without content */
export async function listMlFiles(conversationId: ObjectId): Promise<MlFileListing[]> {
	const rows = await collections.mlFiles
		.aggregate<MlFileListing>([
			{ $match: { conversationId } },
			{ $sort: { name: 1, version: -1 } },
			{
				$group: {
					_id: "$name",
					name: { $first: "$name" },
					version: { $first: "$version" },
					size: { $first: "$size" },
					updatedAt: { $first: "$createdAt" },
					summary: { $first: "$summary" },
				},
			},
			{ $project: { _id: 0 } },
			{ $sort: { name: 1 } },
		])
		.toArray();
	return rows.map((row) => ({
		name: row.name,
		version: row.version,
		size: row.size,
		updatedAt: row.updatedAt,
		...(row.summary ? { summary: row.summary } : {}),
	}));
}
