import { downloadFile, listFiles, type RepoDesignation } from "@huggingface/hub";
import {
	cachedAsyncBuffer,
	parquetMetadataAsync,
	parquetReadObjects,
	parquetSchema,
	type AsyncBuffer,
	type FileMetaData,
} from "hyparquet";
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

export interface ParquetTarget {
	repo: RepoDesignation;
	path: string;
	revision?: string;
}

export interface OpenParquet {
	path: string;
	file: AsyncBuffer;
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
	return { path: target.path, file, metadata, rows: Number(metadata.num_rows) };
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

export async function readSegment(
	segment: Segment,
	columns: string[]
): Promise<Record<string, unknown>[]> {
	if (columns.length === 0) return Array.from({ length: segment.to - segment.from }, () => ({}));
	return parquetReadObjects({
		file: segment.file.file,
		metadata: segment.file.metadata,
		rowStart: segment.from,
		rowEnd: segment.to,
		columns,
		useOffsetIndex: true,
		utf8: false,
	});
}

const CELL_CACHE_BYTES = 128 * 1024 * 1024;
const CELL_CACHE_MS = 15 * 60 * 1000;
const cellCache = new Map<string, { cells: unknown[]; bytes: number; at: number }>();
let cachedBytes = 0;

const cellBytes = (cells: unknown[]) =>
	cells.reduce<number>((sum, cell) => {
		const bytes = (cell as { bytes?: unknown } | null)?.bytes;
		return sum + (bytes instanceof Uint8Array ? bytes.byteLength : 64);
	}, 0);

function remember(key: string, cells: unknown[]) {
	const bytes = cellBytes(cells);
	if (bytes > CELL_CACHE_BYTES) return;
	cellCache.set(key, { cells, bytes, at: Date.now() });
	cachedBytes += bytes;
	for (const [old, entry] of cellCache) {
		if (cachedBytes <= CELL_CACHE_BYTES && Date.now() - entry.at < CELL_CACHE_MS) break;
		cellCache.delete(old);
		cachedBytes -= entry.bytes;
	}
}

const openFiles = new Map<string, { value: Promise<Omit<OpenParquet, "start">>; at: number }>();

/** the footer once per file a while, not once per image */
function openForMedia(target: ParquetTarget, access: HubAccess, key: string) {
	const hit = openFiles.get(key);
	if (hit && Date.now() - hit.at < CELL_CACHE_MS) return hit.value;
	const value = openParquet(target, access, new ReadBudget(Number.POSITIVE_INFINITY));
	value.catch(() => openFiles.delete(key));
	openFiles.set(key, { value, at: Date.now() });
	for (const [old, entry] of openFiles) {
		if (openFiles.size <= 200 && Date.now() - entry.at < CELL_CACHE_MS) break;
		openFiles.delete(old);
	}
	return value;
}

/** without an offset index a grid asks for every row of a group, so its column is read once and kept */
export async function readMediaCell(
	target: ParquetTarget,
	fileRow: number,
	column: string,
	access: HubAccess
): Promise<unknown> {
	// the token is part of the key, a cached read never serves someone who could not make it
	const fileKey = JSON.stringify([target, access.token ?? ""]);
	const opened = await openForMedia(target, access, fileKey);
	const group = groupsOf(opened.metadata).find(
		(g) => g.start <= fileRow && fileRow < g.start + g.rows
	);
	if (!group) throw new ParquetReadError(`row ${fileRow} is past the end of ${target.path}`);
	const read = (rowStart: number, rowEnd: number) =>
		parquetReadObjects({
			file: opened.file,
			metadata: opened.metadata,
			rowStart,
			rowEnd,
			columns: [column],
			useOffsetIndex: true,
			utf8: false,
		});
	if (hasOffsetIndex(opened.metadata, group.index)) {
		return (await read(fileRow, fileRow + 1))[0]?.[column];
	}
	const key = `${fileKey}#${group.index}#${column}`;
	const hit = cellCache.get(key);
	if (hit && Date.now() - hit.at < CELL_CACHE_MS) return hit.cells[fileRow - group.start];
	const bytes = chunkBytes(opened.metadata, group.index, new Set([column]));
	if (bytes > PARQUET_MAX_READ_BYTES) {
		throw new ParquetReadError(
			`${target.path} keeps ${Math.ceil(bytes / 1024 / 1024)} MB of ${column} in one row group with no offset index, past the ${PARQUET_MAX_READ_BYTES / 1024 / 1024} MB one read may take`
		);
	}
	const cells = (await read(group.start, group.start + group.rows)).map((row) => row[column]);
	remember(key, cells);
	return cells[fileRow - group.start];
}
