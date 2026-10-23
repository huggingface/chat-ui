import { downloadFile, type RepoDesignation } from "@huggingface/hub";
import type { ReviewRecordOrigin } from "$lib/types/MlReview";
import { accessSignal, type HubAccess } from "./datasetViewer";
import type { DatasetColumn } from "./features";
import { ParquetReadError, type ReadBudget } from "./parquetSource";
import { mapPool, seededRandom } from "./sampling";
import { parseDelimited } from "./tabular";

export type LineFormat = "jsonl" | "csv" | "tsv";

export function lineFormat(path: string): LineFormat | undefined {
	if (/\.jsonl$/i.test(path)) return "jsonl";
	if (/\.csv$/i.test(path)) return "csv";
	if (/\.tsv$/i.test(path)) return "tsv";
	return undefined;
}

const CHUNK_BYTES = 256 * 1024;
/** a random window wants a few lines so it reads small first */
const FIRST_CHUNK_BYTES = 16 * 1024;
/** a line longer than this is not a record a review can show */
const MAX_SPAN_BYTES = 4 * 1024 * 1024;
const NEWLINE = 0x0a;
const WINDOW_CONCURRENCY = 6;

interface LineFile {
	path: string;
	blob: Blob;
	/** offset in the bytes of all the files together */
	start: number;
}

interface Line {
	text: string;
	file: LineFile;
	byte: number;
}

export interface LineRow {
	row: Record<string, unknown>;
	origin: ReviewRecordOrigin;
}

export interface SampledLines {
	rows: LineRow[];
	columns: DatasetColumn[];
	bytes: number;
	windows?: number;
}

const decoder = new TextDecoder();

async function slice(file: LineFile, from: number, to: number, budget: ReadBudget) {
	const end = Math.min(to, file.blob.size);
	budget.take(end - from);
	return new Uint8Array(await file.blob.slice(from, end).arrayBuffer());
}

/** a position inside a line skips to the next one, so long lines are drawn more often */
async function readLines(
	file: LineFile,
	from: number,
	want: number,
	budget: ReadBudget,
	skipPartial: boolean
): Promise<{ lines: Line[]; eof: boolean }> {
	const lines: Line[] = [];
	let carry = new Uint8Array(0);
	let carryAt = from;
	let at = from;
	let skipping = skipPartial && from > 0;
	let size = FIRST_CHUNK_BYTES;
	while (lines.length < want && at < file.blob.size) {
		if (at - from > MAX_SPAN_BYTES) break;
		const chunk = await slice(file, at, at + size, budget);
		size = Math.min(CHUNK_BYTES, size * 4);
		at += chunk.byteLength;
		const bytes = new Uint8Array(carry.byteLength + chunk.byteLength);
		bytes.set(carry);
		bytes.set(chunk, carry.byteLength);
		let lineStart = 0;
		for (let i = 0; i < bytes.byteLength && lines.length < want; i += 1) {
			if (bytes[i] !== NEWLINE) continue;
			if (skipping) skipping = false;
			else {
				const text = decoder.decode(bytes.subarray(lineStart, i)).replace(/\r$/, "");
				if (text.trim()) lines.push({ text, file, byte: carryAt + lineStart });
			}
			lineStart = i + 1;
		}
		carry = bytes.slice(lineStart);
		carryAt += lineStart;
	}
	const eof = at >= file.blob.size;
	if (eof && !skipping && carry.byteLength > 0 && lines.length < want) {
		const text = decoder.decode(carry).replace(/\r$/, "");
		if (text.trim()) lines.push({ text, file, byte: carryAt });
	}
	return { lines, eof };
}

const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const isChat = (value: unknown) =>
	Array.isArray(value) &&
	value.length > 0 &&
	value.every((t) => isObject(t) && typeof t.role === "string" && typeof t.content === "string");

/** guessed from the values the sample holds */
export function inferFeature(values: unknown[]): unknown {
	const present = values.filter((v) => v !== null && v !== undefined);
	const string = { _type: "Value", dtype: "string" };
	if (present.length === 0 || present.every((v) => typeof v === "string")) return string;
	if (present.every((v) => typeof v === "number")) return { _type: "Value", dtype: "float64" };
	if (present.every((v) => typeof v === "boolean")) return { _type: "Value", dtype: "bool" };
	if (present.every(isChat)) return [{ role: string, content: string }];
	return { _type: "Json" };
}

function jsonColumns(rows: Record<string, unknown>[]): DatasetColumn[] {
	const names: string[] = [];
	const seen = new Set<string>();
	for (const row of rows) {
		for (const key of Object.keys(row)) {
			if (!seen.has(key)) names.push(key);
			seen.add(key);
		}
	}
	return names.map((name) => ({ name, feature: inferFeature(rows.map((r) => r[name])) }));
}

async function headerOf(file: LineFile, budget: ReadBudget): Promise<string | undefined> {
	return (await readLines(file, 0, 1, budget, false)).lines[0]?.text;
}

function parseLine(
	format: LineFormat,
	text: string,
	header: string | undefined
): Record<string, unknown> | undefined {
	if (format === "jsonl") {
		try {
			const parsed: unknown = JSON.parse(text);
			return isObject(parsed) ? parsed : undefined;
		} catch {
			return undefined;
		}
	}
	if (header === undefined) return undefined;
	// a quoted cell holding a newline splits the record, such a line is skipped
	const table = parseDelimited(`${header}\n${text}`, format, "line", 1);
	return "error" in table ? undefined : table.rows[0];
}

async function openLines(
	repo: RepoDesignation,
	paths: string[],
	revision: string | undefined,
	access: HubAccess
): Promise<LineFile[]> {
	const base = access.fetch ?? fetch;
	const files: LineFile[] = [];
	let start = 0;
	for (const path of paths) {
		const blob = await downloadFile({
			repo,
			path,
			...(revision ? { revision } : {}),
			...(access.token ? { accessToken: access.token } : {}),
			fetch: (input, init) => base(input, { ...init, signal: accessSignal(access.signal, 60_000) }),
			xet: false,
		});
		if (!blob) throw new ParquetReadError(`${path} does not exist`);
		files.push({ path, blob, start });
		start += blob.size;
	}
	return files;
}

export async function sampleLines({
	repo,
	paths,
	revision,
	format,
	method,
	rows,
	offset = 0,
	seed,
	maxWindows,
	access,
	budget,
}: {
	repo: RepoDesignation;
	paths: string[];
	revision?: string;
	format: LineFormat;
	method: "head" | "random";
	rows: number;
	offset?: number;
	seed: number;
	maxWindows: number;
	access: HubAccess;
	budget: ReadBudget;
}): Promise<SampledLines> {
	const files = await openLines(repo, paths, revision, access);
	const bytes = files.reduce((sum, f) => sum + f.blob.size, 0);
	const headers = new Map<LineFile, string | undefined>();
	const header = async (file: LineFile) => {
		if (format === "jsonl") return undefined;
		if (!headers.has(file)) headers.set(file, await headerOf(file, budget));
		return headers.get(file);
	};

	if (method === "head" && format !== "jsonl") {
		return headDelimited(files, format, offset + rows, budget, bytes, offset);
	}

	const picked: { line: Line; row?: number; fileRow?: number }[] = [];
	let windows: number | undefined;
	if (method === "head") {
		let row = 0;
		for (const file of files) {
			let at = 0;
			let fileRow = 0;
			while (picked.length < rows) {
				const want = rows - picked.length + Math.max(0, offset - row);
				const read = await readLines(file, at, Math.min(want, 5_000), budget, false);
				for (const line of read.lines) {
					if (row >= offset && picked.length < rows) picked.push({ line, row, fileRow });
					row += 1;
					fileRow += 1;
				}
				const last = read.lines[read.lines.length - 1];
				if (read.eof || !last) break;
				at = last.byte + Buffer.byteLength(last.text, "utf8") + 1;
			}
			if (picked.length >= rows) break;
		}
	} else {
		const per = Math.ceil(rows / Math.max(1, Math.min(maxWindows, rows)));
		const count = Math.ceil(rows / per);
		const random = seededRandom(seed);
		const seen = new Set<string>();
		windows = count;
		const starts = Array.from({ length: count }, (_, i) => {
			const from = Math.floor((i * bytes) / count);
			const span = Math.floor(((i + 1) * bytes) / count) - from;
			return from + Math.floor(random() * span);
		});
		const reads = await mapPool(starts, WINDOW_CONCURRENCY, (at) => {
			const file = files.findLast((f) => f.start <= at) ?? files[0];
			return readLines(file, at - file.start, per, budget, true);
		});
		for (const read of reads) {
			for (const line of read.lines) {
				const file = line.file;
				const key = `${file.path}#${line.byte}`;
				if (seen.has(key) || picked.length >= rows) continue;
				seen.add(key);
				if (format !== "jsonl" && line.byte === 0) continue;
				picked.push({ line });
			}
		}
	}

	const parsed: LineRow[] = [];
	for (const { line, row, fileRow } of picked) {
		const value = parseLine(format, line.text, await header(line.file));
		if (!value) {
			if (method === "head") {
				throw new ParquetReadError(
					`${line.file.path} line at byte ${line.byte} is not a JSON object`
				);
			}
			continue;
		}
		parsed.push({
			row: value,
			origin: {
				...(row !== undefined ? { row } : {}),
				...(fileRow !== undefined ? { fileRow } : {}),
				file: line.file.path,
				byte: line.byte,
			},
		});
	}

	let columns: DatasetColumn[];
	if (format === "jsonl") columns = jsonColumns(parsed.map((p) => p.row));
	else {
		const head = files[0] ? await header(files[0]) : undefined;
		const table = head ? parseDelimited(head, format, "header", 0) : undefined;
		const names = table && !("error" in table) ? table.columns : [];
		columns = names.map((name) => ({ name, feature: { _type: "Value", dtype: "string" } }));
	}
	return { rows: parsed, columns, bytes, ...(windows ? { windows } : {}) };
}

/** parsed whole so a quoted cell may hold newlines */
async function headDelimited(
	files: LineFile[],
	format: "csv" | "tsv",
	need: number,
	budget: ReadBudget,
	bytes: number,
	skip: number
): Promise<SampledLines> {
	const rows: LineRow[] = [];
	let columns: DatasetColumn[] | undefined;
	let row = 0;
	for (const file of files) {
		let acc = new Uint8Array(0);
		let at = 0;
		let parsed: Record<string, string>[] = [];
		while (at < file.blob.size && at <= MAX_SPAN_BYTES) {
			const chunk = await slice(file, at, at + CHUNK_BYTES, budget);
			at += chunk.byteLength;
			const grown = new Uint8Array(acc.byteLength + chunk.byteLength);
			grown.set(acc);
			grown.set(chunk, acc.byteLength);
			acc = grown;
			const eof = at >= file.blob.size;
			const cut = eof ? acc.byteLength : acc.lastIndexOf(NEWLINE) + 1;
			const table = parseDelimited(
				decoder.decode(acc.subarray(0, cut)),
				format,
				file.path,
				Number.MAX_SAFE_INTEGER
			);
			if ("error" in table) {
				if (!eof && /never closes/.test(table.error)) continue;
				throw new ParquetReadError(table.error);
			}
			columns ??= table.columns.map((name) => ({
				name,
				feature: { _type: "Value", dtype: "string" },
			}));
			parsed = table.rows;
			if (row + parsed.length >= need) break;
		}
		for (const [fileRow, value] of parsed.entries()) {
			if (row >= skip && rows.length < need - skip) {
				rows.push({ row: value, origin: { row, file: file.path, fileRow } });
			}
			row += 1;
		}
		if (rows.length >= need - skip) break;
	}
	return { rows, columns: columns ?? [], bytes };
}
