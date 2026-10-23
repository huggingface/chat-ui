import type { ObjectId } from "mongodb";
import type { McpServerConfig } from "$lib/server/mcp/httpClient";
import { listMlFiles, readMlFile } from "$lib/server/mlFiles";
import { parseVirtualFileRef } from "$lib/server/mlFiles/refs";
import {
	HUB_PAGE_BYTES,
	SANDBOX_PAGE_BYTES,
	readHubPage,
	readSandboxPage,
	readWhole,
} from "$lib/server/mlFiles/remoteRead";
import type { ReviewSource } from "$lib/types/MlReview";
import { parseDelimited, tabularFormat, type TabularRows } from "./tabular";
import { parseTableInput, type TableInput } from "./tableSource";
import {
	REVIEW_MAX_BYTES,
	REVIEW_MAX_INLINE_CHARS,
	REVIEW_MAX_INLINE_RECORDS,
	REVIEW_MAX_RECORDS,
} from "$lib/server/textGeneration/builtinTools/requestReviewDefinition";

const OUTCOME = "no review was opened";
const HUB_MAX_PAGES = 32;
const HUB_MAX_BYTES = HUB_MAX_PAGES * HUB_PAGE_BYTES;
const SANDBOX_MAX_PAGES = Math.ceil(REVIEW_MAX_BYTES / SANDBOX_PAGE_BYTES) + 1;

export type RecordsInput =
	| { records: unknown[] }
	| { file: string }
	| { sandbox: { handle: string; path: string } }
	| { hub: string };

const SOURCE_KEYS = ["records", "file", "sandbox", "hub", "dataset", "parquet"] as const;
const SOURCE_KEY_LIST = "records, file, sandbox, hub, dataset or parquet";

export type LoadedRecords =
	| {
			ok: true;
			records: unknown[];
			source: ReviewSource;
			/** set for a csv or tsv file, whose string cells still need the declared types */
			table?: TabularRows;
	  }
	| { ok: false; error: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

export function parseRecordsInput(source: unknown): RecordsInput | TableInput | { error: string } {
	if (!isRecord(source)) {
		return { error: `source must be an object with one of ${SOURCE_KEY_LIST}` };
	}
	const given = SOURCE_KEYS.filter((key) => source[key] !== undefined);
	if (given.length !== 1) {
		return {
			error: `source must have exactly one of ${SOURCE_KEY_LIST}, got ${
				given.length === 0 ? "none" : given.join(", ")
			}`,
		};
	}
	const [key] = given;
	const value = source[key];
	switch (key) {
		case "dataset":
		case "parquet":
			return parseTableInput(key, value);
		case "records":
			return Array.isArray(value) ? { records: value } : { error: "source.records must be a list" };
		case "file":
			return typeof value === "string" && value.trim()
				? { file: value.trim() }
				: { error: "source.file must be a virtual file name" };
		case "sandbox":
			return isRecord(value) &&
				typeof value.handle === "string" &&
				value.handle.trim() &&
				typeof value.path === "string" &&
				value.path.trim()
				? { sandbox: { handle: value.handle.trim(), path: value.path.trim() } }
				: { error: 'source.sandbox must be {"handle", "path"}' };
		case "hub":
			return typeof value === "string" && /^hf:\/\/\S+$/.test(value.trim())
				? { hub: value.trim() }
				: { error: "source.hub must be an hf:// file URI" };
	}
}

/** name, name@3, name@v3 or v-file://name@v3 */
export function parseFileSource(value: string): { name: string; version?: number } {
	const ref = parseVirtualFileRef(value);
	if (ref)
		return { name: ref.name, ...(ref.version !== undefined ? { version: ref.version } : {}) };
	const match = /^(.+?)@v?(\d+)$/.exec(value);
	return match ? { name: match[1], version: Number(match[2]) } : { name: value };
}

/** a json array, or jsonl with blank lines ignored */
export function parseRecordsText(
	text: string,
	location: string
): { records: unknown[] } | { error: string } {
	const trimmed = text.trim();
	if (!trimmed) return { error: `${location} is empty` };
	if (trimmed.startsWith("[")) {
		try {
			const parsed: unknown = JSON.parse(trimmed);
			if (Array.isArray(parsed)) return { records: parsed };
		} catch {
			// a JSONL file whose first record is a list reads as one too, so fall through
		}
	}
	const records: unknown[] = [];
	for (const [index, line] of trimmed.split("\n").entries()) {
		if (!line.trim()) continue;
		try {
			records.push(JSON.parse(line));
		} catch {
			return {
				error: `${location} line ${index + 1} is not valid JSON; give a JSON array or one JSON object per line`,
			};
		}
	}
	return { records };
}

const tooLarge = (location: string, size: number) =>
	`${location} is ${size.toLocaleString("en-US")} bytes or more; a review holds at most ${
		REVIEW_MAX_BYTES / 1024 / 1024
	} MB of records. Split it into batches on the same schema`;

function capped(records: unknown[], bytes: number, location: string): LoadedRecords | undefined {
	if (records.length > REVIEW_MAX_RECORDS) {
		return {
			ok: false,
			error: `${location} has ${records.length} records; a review holds at most ${REVIEW_MAX_RECORDS}. Split it into batches on the same schema`,
		};
	}
	if (bytes > REVIEW_MAX_BYTES) return { ok: false, error: tooLarge(location, bytes) };
	if (records.length === 0) return { ok: false, error: `${location} holds no records` };
	return undefined;
}

export async function loadRecords(
	input: RecordsInput,
	{
		conversationId,
		hubServer,
		signal,
	}: { conversationId: ObjectId; hubServer?: McpServerConfig; signal?: AbortSignal }
): Promise<LoadedRecords> {
	if ("records" in input) {
		const chars = JSON.stringify(input.records).length;
		if (input.records.length > REVIEW_MAX_INLINE_RECORDS || chars > REVIEW_MAX_INLINE_CHARS) {
			return {
				ok: false,
				error: `${input.records.length} records inline (${chars.toLocaleString("en-US")} characters): inline records are capped at ${REVIEW_MAX_INLINE_RECORDS} and ${REVIEW_MAX_INLINE_CHARS.toLocaleString("en-US")} characters, write them to a file and pass source.file`,
			};
		}
		return (
			capped(input.records, chars, "source.records") ?? {
				ok: true,
				records: input.records,
				source: { kind: "inline" },
			}
		);
	}

	let text: string;
	let source: ReviewSource;
	let location: string;
	if ("file" in input) {
		const { name, version } = parseFileSource(input.file);
		const file = await readMlFile(conversationId, name, version);
		if (!file) {
			const files = await listMlFiles(conversationId);
			const known = files.length
				? `Files that exist: ${files.map((f) => `${f.name} (v${f.version})`).join(", ")}.`
				: "There are no virtual files in this conversation yet.";
			return {
				ok: false,
				error: `No virtual file "${name}"${version !== undefined ? ` at v${version}` : ""}. ${known}`,
			};
		}
		text = file.content;
		location = `${file.name} v${file.version}`;
		source = { kind: "file", name: file.name, version: file.version };
	} else {
		if (!hubServer) {
			return {
				ok: false,
				error:
					"No Hugging Face MCP server is connected in this turn, so there is nothing to read the records from.",
			};
		}
		if ("sandbox" in input) {
			const { handle, path } = input.sandbox;
			location = `${handle}:${path}`;
			source = { kind: "sandbox", handle, path };
		} else {
			location = input.hub;
			source = { kind: "hub", uri: input.hub };
		}
		let read: Awaited<ReturnType<typeof readWhole>>;
		try {
			read = await readWhole(
				(offset) =>
					"sandbox" in input
						? readSandboxPage(hubServer, input.sandbox, offset, signal, OUTCOME)
						: readHubPage(hubServer, input.hub, offset, signal, OUTCOME),
				location,
				"sandbox" in input
					? {
							maxBytes: REVIEW_MAX_BYTES,
							maxPages: SANDBOX_MAX_PAGES,
							tooLarge,
							outcome: OUTCOME,
						}
					: { maxBytes: HUB_MAX_BYTES, maxPages: HUB_MAX_PAGES, tooLarge, outcome: OUTCOME }
			);
		} catch (err) {
			if (signal?.aborted) return { ok: false, error: "Aborted by user" };
			return {
				ok: false,
				error: `Could not read ${location}: ${err instanceof Error ? err.message : String(err)}`,
			};
		}
		if ("error" in read) return { ok: false, error: read.error };
		text = read.content;
	}

	const format = tabularFormat(
		source.kind === "file" ? source.name : source.kind === "sandbox" ? source.path : location
	);
	if (format) {
		const table = parseDelimited(text, format, location);
		if ("error" in table) return { ok: false, error: table.error };
		return (
			capped(table.rows, Buffer.byteLength(text, "utf8"), location) ?? {
				ok: true,
				records: table.rows,
				source,
				table,
			}
		);
	}
	const parsed = parseRecordsText(text, location);
	if ("error" in parsed) return { ok: false, error: parsed.error };
	return (
		capped(parsed.records, Buffer.byteLength(text, "utf8"), location) ?? {
			ok: true,
			records: parsed.records,
			source,
		}
	);
}
