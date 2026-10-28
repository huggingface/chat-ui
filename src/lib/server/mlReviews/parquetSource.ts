import { downloadFile, listFiles, type RepoDesignation } from "@huggingface/hub";
import { decompress as decompressZstd } from "fzstd";
import {
	cachedAsyncBuffer,
	parquetMetadataAsync,
	parquetReadObjects,
	parquetSchema,
	type AsyncBuffer,
	type Compressors,
	type FileMetaData,
} from "hyparquet";
// hyparquet itself decodes only snappy, most dataset files are zstd
import { compressors } from "hyparquet-compressors";
import { accessSignal, type HubAccess } from "./datasetViewer";
import type { DatasetColumn } from "./features";
import type { RowWindow } from "./sampling";

/** per review, past it the model samples fewer rows or columns */
export const PARQUET_MAX_READ_BYTES = 64 * 1024 * 1024;
export const PARQUET_MAX_FILES = 100;
/** most footers are a few kb, hyparquet reads 512 kb first by default */
const FOOTER_FETCH_BYTES = 64 * 1024;

export class ParquetReadError extends Error {}

export class ReadBudget {
	bytes = 0;
	constructor(readonly limit = PARQUET_MAX_READ_BYTES) {}
	take(bytes: number) {
		this.bytes += bytes;
		if (this.bytes > this.limit) {
			throw new ParquetReadError(
				`reading this sample would pass ${this.limit / 1024 / 1024} MB of Parquet range reads; sample fewer rows or declare fewer fields`
			);
		}
	}
}

/** a page header can claim any size, the decoder allocates what it claims */
export const PARQUET_MAX_PAGE_BYTES = 64 * 1024 * 1024;
export const PARQUET_MAX_DECODED_BYTES = 128 * 1024 * 1024;

const mb = (bytes: number) => Math.ceil(bytes / 1024 / 1024);

/** decoded bytes, checked against each header before the decoder allocates them */
export class DecodeBudget {
	bytes = 0;
	constructor(
		readonly limit = PARQUET_MAX_DECODED_BYTES,
		readonly pageLimit = PARQUET_MAX_PAGE_BYTES
	) {}
	take(bytes: number, what = "a page") {
		if (bytes > this.pageLimit && what === "a page") {
			throw new ParquetReadError(
				`a Parquet page claims ${mb(bytes)} MB decoded, past the ${mb(this.pageLimit)} MB one page may take`
			);
		}
		this.bytes += bytes;
		if (this.bytes > this.limit) {
			throw new ParquetReadError(
				`${what === "a page" ? "decoding this sample" : what} would pass ${mb(this.limit)} MB of decoded Parquet; sample fewer rows or declare fewer fields`
			);
		}
	}
}

/** every codec behind the budget, zstd into a buffer of the claimed size so a frame cannot outgrow it */
export function guardedCompressors(budget: DecodeBudget): Compressors {
	const guarded: Compressors = {};
	for (const [codec, decode] of Object.entries(compressors) as [
		keyof Compressors,
		NonNullable<Compressors[keyof Compressors]>,
	][]) {
		guarded[codec] = (input, length) => {
			budget.take(length);
			return codec === "ZSTD"
				? decompressZstd(input, new Uint8Array(length))
				: decode(input, length);
		};
	}
	return guarded;
}

export interface ParquetTarget {
	repo: RepoDesignation;
	path: string;
	revision?: string;
}

export interface OpenParquet {
	path: string;
	file: AsyncBuffer;
	blob: Blob;
	metadata: FileMetaData;
	rows: number;
	/** first row of this file counted across the source files */
	start: number;
}

function withSignal(access: HubAccess): typeof fetch {
	const base = access.fetch ?? fetch;
	return (input, init) => base(input, { ...init, signal: accessSignal(access.signal, 60_000) });
}

/** a lazy blob, each slice is one range read */
export async function openParquet(
	target: ParquetTarget,
	access: HubAccess,
	budget: ReadBudget
): Promise<Omit<OpenParquet, "start">> {
	const blob = await downloadFile({
		repo: target.repo,
		path: target.path,
		...(target.revision ? { revision: target.revision } : {}),
		...(access.token ? { accessToken: access.token } : {}),
		fetch: withSignal(access),
		// a plain range is one round trip a slice and xet two, buckets are xet only
		...(typeof target.repo === "object" && target.repo.type === "bucket" ? {} : { xet: false }),
	});
	if (!blob) throw new ParquetReadError(`${target.path} does not exist`);
	const file = cachedAsyncBuffer({
		byteLength: blob.size,
		slice: (start, end) => {
			budget.take((end ?? blob.size) - start);
			return blob.slice(start, end).arrayBuffer();
		},
	});
	let metadata: FileMetaData;
	try {
		metadata = await parquetMetadataAsync(file, { initialFetchSize: FOOTER_FETCH_BYTES });
	} catch (err) {
		if (err instanceof ParquetReadError) throw err;
		throw new ParquetReadError(`${target.path} is not a readable Parquet file`);
	}
	return { path: target.path, file, blob, metadata, rows: Number(metadata.num_rows) };
}

/** a large repo tree is not walked to the end for a few files */
const MAX_LISTED_ENTRIES = 5_000;

/** the tree endpoint takes the revision encoded as one segment */
export async function listDataFiles(
	repo: RepoDesignation,
	folder: string,
	revision: string | undefined,
	access: HubAccess,
	extension: RegExp = /\.parquet$/
): Promise<string[]> {
	const paths: string[] = [];
	let seen = 0;
	for await (const entry of listFiles({
		repo,
		...(folder ? { path: folder } : {}),
		recursive: true,
		...(revision ? { revision: encodeURIComponent(revision) } : {}),
		...(access.token ? { accessToken: access.token } : {}),
		fetch: withSignal(access),
	})) {
		if (entry.type === "file" && extension.test(entry.path)) paths.push(entry.path);
		seen += 1;
		if (paths.length > PARQUET_MAX_FILES || seen >= MAX_LISTED_ENTRIES) break;
	}
	return paths.sort();
}

/** for the configs and splits of the converted branch */
export async function listFolders(
	repo: RepoDesignation,
	folder: string,
	revision: string,
	access: HubAccess
): Promise<string[]> {
	const folders: string[] = [];
	for await (const entry of listFiles({
		repo,
		...(folder ? { path: folder } : {}),
		revision: encodeURIComponent(revision),
		...(access.token ? { accessToken: access.token } : {}),
		fetch: withSignal(access),
	})) {
		if (entry.type === "directory") folders.push(entry.path);
	}
	return folders.sort();
}

const HF_KEY = "huggingface";

/** the datasets library features when it wrote the file, else the schema */
export function parquetColumns(metadata: FileMetaData): DatasetColumn[] {
	const declared = metadata.key_value_metadata?.find((kv) => kv.key === HF_KEY)?.value;
	if (declared) {
		try {
			const parsed = JSON.parse(declared) as { info?: { features?: Record<string, unknown> } };
			const features = parsed.info?.features;
			if (features && typeof features === "object") {
				return Object.entries(features).map(([name, feature]) => ({ name, feature }));
			}
		} catch {
			// a file with broken metadata still reads by its schema
		}
	}
	return parquetSchema(metadata).children.map((child) => {
		const parts = new Set(child.children.map((c) => c.element.name));
		return {
			name: child.element.name,
			// how the datasets library stores media when written without its metadata
			feature:
				parts.size === 2 && parts.has("bytes") && parts.has("path")
					? { _type: "Media" }
					: featureFromSchema(child.element, child.children.length > 0),
		};
	});
}

function featureFromSchema(
	element: FileMetaData["schema"][number],
	nested: boolean
): Record<string, unknown> {
	if (nested) return { _type: "Json" };
	const string =
		element.converted_type === "UTF8" ||
		element.logical_type?.type === "STRING" ||
		element.converted_type === "JSON";
	switch (element.type) {
		case "BOOLEAN":
			return { _type: "Value", dtype: "bool" };
		case "INT32":
		case "INT64":
		case "FLOAT":
		case "DOUBLE":
			return element.logical_type?.type === "TIMESTAMP" || element.converted_type === "DATE"
				? { _type: "Value", dtype: "timestamp" }
				: {
						_type: "Value",
						dtype: element.type === "FLOAT" || element.type === "DOUBLE" ? "float64" : "int64",
					};
		case "BYTE_ARRAY":
			return string ? { _type: "Value", dtype: "string" } : { _type: "Value", dtype: "binary" };
		default:
			return { _type: "Value", dtype: "binary" };
	}
}

export interface Group {
	start: number;
	rows: number;
	index: number;
}

export function groupsOf(metadata: FileMetaData): Group[] {
	let start = 0;
	return metadata.row_groups.map((group, index) => {
		const rows = Number(group.num_rows);
		const bounds = { start, rows, index };
		start += rows;
		return bounds;
	});
}

function chunkBytes(metadata: FileMetaData, group: number, columns: Set<string>): number {
	return metadata.row_groups[group].columns.reduce((sum, chunk) => {
		const top = chunk.meta_data?.path_in_schema[0];
		return top !== undefined && columns.has(top)
			? sum + Number(chunk.meta_data?.total_compressed_size ?? 0)
			: sum;
	}, 0);
}

const hasOffsetIndex = (metadata: FileMetaData, group: number) =>
	metadata.row_groups[group].columns.every((chunk) => chunk.offset_index_offset !== undefined);

export interface Segment {
	file: OpenParquet;
	/** rows within the file, end exclusive */
	from: number;
	to: number;
}

/** cut where a window crosses into the next file */
export function segmentsOf(files: OpenParquet[], windows: RowWindow[]): Segment[] {
	const segments: Segment[] = [];
	for (const window of windows) {
		let at = window.offset;
		const end = window.offset + window.length;
		while (at < end) {
			const file = files.findLast((f) => f.start <= at);
			if (!file || at >= file.start + file.rows) break;
			const to = Math.min(end, file.start + file.rows);
			segments.push({ file, from: at - file.start, to: to - file.start });
			at = to;
		}
	}
	return segments;
}

/** media groups count once, without an offset index a group costs its whole chunk */
export function planBytes(segments: Segment[], data: Set<string>, media: Set<string>): number {
	const seen = new Set<string>();
	let bytes = 0;
	for (const { file, from, to } of segments) {
		for (const group of groupsOf(file.metadata)) {
			if (group.start >= to || group.start + group.rows <= from) continue;
			const key = `${file.path}#${group.index}`;
			const share = hasOffsetIndex(file.metadata, group.index)
				? (Math.min(to, group.start + group.rows) - Math.max(from, group.start)) / group.rows
				: 1;
			bytes += chunkBytes(file.metadata, group.index, data) * share;
			if (!seen.has(key)) bytes += chunkBytes(file.metadata, group.index, media);
			seen.add(key);
		}
	}
	return Math.ceil(bytes);
}

function decodedBytes(metadata: FileMetaData, group: number, columns: Set<string>): number {
	return metadata.row_groups[group].columns.reduce((sum, chunk) => {
		const top = chunk.meta_data?.path_in_schema[0];
		return top !== undefined && columns.has(top)
			? sum + Number(chunk.meta_data?.total_uncompressed_size ?? 0)
			: sum;
	}, 0);
}

/** the chunks a read touches, decoded, before any of it is fetched */
function checkDecoded(
	metadata: FileMetaData,
	from: number,
	to: number,
	columns: Set<string>,
	decode: DecodeBudget,
	where: string
) {
	let bytes = 0;
	for (const group of groupsOf(metadata)) {
		if (group.start >= to || group.start + group.rows <= from) continue;
		bytes += decodedBytes(metadata, group.index, columns);
	}
	if (bytes > decode.limit - decode.bytes) {
		throw new ParquetReadError(
			`${where} would decode ${mb(bytes)} MB, past the ${mb(decode.limit)} MB a read may decode; sample fewer rows or declare fewer fields`
		);
	}
}

export async function readSegment(
	segment: Segment,
	columns: string[],
	decode = new DecodeBudget()
): Promise<Record<string, unknown>[]> {
	if (columns.length === 0) return Array.from({ length: segment.to - segment.from }, () => ({}));
	checkDecoded(
		segment.file.metadata,
		segment.from,
		segment.to,
		new Set(columns),
		decode,
		segment.file.path
	);
	return parquetReadObjects({
		file: segment.file.file,
		metadata: segment.file.metadata,
		rowStart: segment.from,
		rowEnd: segment.to,
		columns,
		useOffsetIndex: true,
		utf8: false,
		compressors: guardedCompressors(decode),
	});
}

/** per replica and shared by every user on it, so each cache is held to a byte budget and a short ttl */
const MEDIA_CACHE_MS = 5 * 60 * 1000;
const MEDIA_FILES = 32;
const RANGE_CACHE_BYTES = 64 * 1024 * 1024;
const CELL_CACHE_BYTES = 64 * 1024 * 1024;

/** least recently used first, a hit moves to the back */
class ByteCache<T> {
	#entries = new Map<string, { value: T; bytes: number; at: number }>();
	#bytes = 0;
	constructor(
		readonly limit: number,
		readonly ttl = MEDIA_CACHE_MS
	) {}
	get(key: string): T | undefined {
		const hit = this.#entries.get(key);
		if (!hit) return undefined;
		this.#entries.delete(key);
		if (Date.now() - hit.at >= this.ttl) {
			this.#bytes -= hit.bytes;
			return undefined;
		}
		this.#entries.set(key, hit);
		return hit.value;
	}
	set(key: string, value: T, bytes: number) {
		if (bytes > this.limit) return;
		const old = this.#entries.get(key);
		if (old) {
			this.#entries.delete(key);
			this.#bytes -= old.bytes;
		}
		this.#entries.set(key, { value, bytes, at: Date.now() });
		this.#bytes += bytes;
		for (const [oldest, entry] of this.#entries) {
			if (this.#bytes <= this.limit && Date.now() - entry.at < this.ttl) break;
			this.#entries.delete(oldest);
			this.#bytes -= entry.bytes;
		}
	}
	delete(key: string) {
		const hit = this.#entries.get(key);
		if (!hit) return;
		this.#entries.delete(key);
		this.#bytes -= hit.bytes;
	}
	get size() {
		return this.#entries.size;
	}
	get bytes() {
		return this.#bytes;
	}
}

const rangeCache = new ByteCache<ArrayBuffer>(RANGE_CACHE_BYTES);
const cellCache = new ByteCache<unknown[]>(CELL_CACHE_BYTES);
const openFiles = new ByteCache<Promise<Pick<OpenParquet, "blob" | "metadata">>>(MEDIA_FILES);

const cellBytes = (cells: unknown[]) =>
	cells.reduce<number>((sum, cell) => {
		const bytes = (cell as { bytes?: unknown } | null)?.bytes;
		return sum + (bytes instanceof Uint8Array ? bytes.byteLength : 64);
	}, 0);

/** the footer once per file a while, not once per image, a file counts one toward the cap */
function openForMedia(target: ParquetTarget, access: HubAccess, key: string) {
	const hit = openFiles.get(key);
	if (hit) return hit;
	const value = openParquet(target, access, new ReadBudget()).then(({ blob, metadata }) => ({
		blob,
		metadata,
	}));
	value.catch(() => openFiles.delete(key));
	openFiles.set(key, value, 1);
	return value;
}

/** the reads of one request, under its own budget, through the shared range cache */
function mediaBuffer(blob: Blob, key: string, budget: ReadBudget): AsyncBuffer {
	return {
		byteLength: blob.size,
		async slice(start, end) {
			const stop = end ?? blob.size;
			const rangeKey = `${key}#${start}-${stop}`;
			const hit = rangeCache.get(rangeKey);
			if (hit) return hit;
			budget.take(stop - start);
			const bytes = await blob.slice(start, stop).arrayBuffer();
			rangeCache.set(rangeKey, bytes, bytes.byteLength);
			return bytes;
		},
	};
}

/** without an offset index a grid asks for every row of a group, so its column is read once and kept */
export async function readMediaCell(
	target: ParquetTarget,
	fileRow: number,
	column: string,
	access: HubAccess,
	limits: { read?: ReadBudget; decode?: DecodeBudget } = {}
): Promise<unknown> {
	// the token is part of the key, a cached read never serves someone who could not make it
	const fileKey = JSON.stringify([target, access.token ?? ""]);
	const opened = await openForMedia(target, access, fileKey);
	const group = groupsOf(opened.metadata).find(
		(g) => g.start <= fileRow && fileRow < g.start + g.rows
	);
	if (!group) throw new ParquetReadError(`row ${fileRow} is past the end of ${target.path}`);
	const decode = limits.decode ?? new DecodeBudget();
	const file = mediaBuffer(opened.blob, fileKey, limits.read ?? new ReadBudget());
	const read = (rowStart: number, rowEnd: number) => {
		checkDecoded(opened.metadata, rowStart, rowEnd, new Set([column]), decode, target.path);
		return parquetReadObjects({
			file,
			metadata: opened.metadata,
			rowStart,
			rowEnd,
			columns: [column],
			useOffsetIndex: true,
			utf8: false,
			compressors: guardedCompressors(decode),
		});
	};
	if (hasOffsetIndex(opened.metadata, group.index)) {
		return (await read(fileRow, fileRow + 1))[0]?.[column];
	}
	const key = `${fileKey}#${group.index}#${column}`;
	const hit = cellCache.get(key);
	if (hit) return hit[fileRow - group.start];
	const bytes = chunkBytes(opened.metadata, group.index, new Set([column]));
	if (bytes > PARQUET_MAX_READ_BYTES) {
		throw new ParquetReadError(
			`${target.path} keeps ${mb(bytes)} MB of ${column} in one row group with no offset index, past the ${mb(PARQUET_MAX_READ_BYTES)} MB one read may take`
		);
	}
	const cells = (await read(group.start, group.start + group.rows)).map((row) => row[column]);
	cellCache.set(key, cells, cellBytes(cells));
	return cells[fileRow - group.start];
}

/** for specs, what the media caches hold right now */
export const mediaCacheSizes = () => ({
	files: openFiles.size,
	rangeBytes: rangeCache.bytes,
	cellBytes: cellCache.bytes,
});
