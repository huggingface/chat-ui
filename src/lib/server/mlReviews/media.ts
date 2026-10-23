import type { RepoDesignation } from "@huggingface/hub";
import type { MlReview, ReviewField, ReviewFieldType } from "$lib/types/MlReview";
import { parseHfUri } from "$lib/server/mlRegistry/hubUri";
import { viewerWindow, ViewerError, type HubAccess } from "./datasetViewer";
import { columnOf } from "./features";
import { ParquetReadError, readMediaCell, type ParquetTarget } from "./parquetSource";
import { mapPool, splitWindows, type RowWindow } from "./sampling";

export type MediaOutcome =
	/** set when every link was signed again, for the caller to keep */
	| { redirect: string; links?: Record<string, string>[] }
	| { bytes: Uint8Array; contentType: string }
	| { status: number; message: string };

const missing = (message: string): MediaOutcome => ({ status: 404, message });

const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** Image and Video cells hold src, Audio a list of them, some a bare url */
export function viewerMediaSrc(cell: unknown): string | undefined {
	const first = Array.isArray(cell) ? cell[0] : cell;
	if (typeof first === "string") return first;
	return isObject(first) && typeof first.src === "string" ? first.src : undefined;
}

/** only the viewer asset hosts, a dataset row cannot aim the redirect anywhere */
export function isViewerAssetUrl(src: string): boolean {
	try {
		const url = new URL(src);
		return (
			url.protocol === "https:" &&
			(url.hostname === "huggingface.co" ||
				url.hostname.endsWith(".huggingface.co") ||
				url.hostname.endsWith(".hf.co"))
		);
	} catch {
		return false;
	}
}

/** longer than the 10 minutes a browser keeps the redirect, a link without Expires is always signed again */
const LINK_MARGIN_MS = 15 * 60 * 1000;
const RESIGN_CONCURRENCY = 4;
const RESIGN_REUSE_MS = 60_000;

function linkExpiresAt(src: string): number | undefined {
	try {
		const expires = Number(new URL(src).searchParams.get("Expires"));
		return Number.isFinite(expires) && expires > 0 ? expires * 1000 : undefined;
	} catch {
		return undefined;
	}
}

const usableLink = (src: string | undefined, now: number): src is string =>
	!!src && isViewerAssetUrl(src) && (linkExpiresAt(src) ?? 0) - now > LINK_MARGIN_MS;

export function viewerMediaLinks(
	row: Record<string, unknown>,
	fields: ReviewField[]
): Record<string, string> {
	const links: Record<string, string> = {};
	for (const field of fields) {
		const src = viewerMediaSrc(row[columnOf(field)]);
		if (src && isViewerAssetUrl(src)) links[field.name] = src;
	}
	return links;
}

function rowRuns(rows: number[]): RowWindow[] {
	const runs: RowWindow[] = [];
	for (const row of [...new Set(rows)].sort((a, b) => a - b)) {
		const last = runs.at(-1);
		if (last && last.offset + last.length === row) last.length += 1;
		else runs.push({ offset: row, length: 1 });
	}
	return splitWindows(runs);
}

const resigning = new Map<string, Promise<Record<string, string>[]>>();

/** the viewer rate limits by ip, so a review is signed again in as few reads as its sample took */
function resignLinks(review: MlReview, access: HubAccess): Promise<Record<string, string>[]> {
	const key = String(review._id);
	const running = resigning.get(key);
	if (running) return running;
	const source = review.source;
	if (source.kind !== "dataset") return Promise.resolve([]);
	const target = { dataset: source.repo, config: source.config, split: source.split };
	const fields = review.schema.fields;
	const rows = review.records.flatMap((r) =>
		r.media?.length && r.origin?.row !== undefined ? [r.origin.row] : []
	);
	const work = mapPool(rowRuns(rows), RESIGN_CONCURRENCY, (w) =>
		viewerWindow(target, w, access)
	).then((pages) => {
		const byRow = new Map(pages.flatMap((p) => p.rows).map((r) => [r.row_idx, r.row]));
		return review.records.map((record) => {
			const row = record.origin?.row !== undefined ? byRow.get(record.origin.row) : undefined;
			const media = fields.filter((f) => record.media?.includes(f.name));
			return row ? viewerMediaLinks(row, media) : {};
		});
	});
	// requests that read the review before the new links were kept still join this one
	work.then(
		() => setTimeout(() => resigning.delete(key), RESIGN_REUSE_MS).unref?.(),
		() => resigning.delete(key)
	);
	resigning.set(key, work);
	return work;
}

const SIGNATURES: { type: string; kind: ReviewFieldType; test: (b: Uint8Array) => boolean }[] = [
	{
		type: "image/jpeg",
		kind: "image",
		test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
	},
	{
		type: "image/png",
		kind: "image",
		test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
	},
	{ type: "image/gif", kind: "image", test: (b) => ascii(b, 0, 4) === "GIF8" },
	{
		type: "image/webp",
		kind: "image",
		test: (b) => ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP",
	},
	{ type: "image/bmp", kind: "image", test: (b) => ascii(b, 0, 2) === "BM" },
	{
		type: "audio/wav",
		kind: "audio",
		test: (b) => ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WAVE",
	},
	{ type: "audio/flac", kind: "audio", test: (b) => ascii(b, 0, 4) === "fLaC" },
	{ type: "audio/ogg", kind: "audio", test: (b) => ascii(b, 0, 4) === "OggS" },
	{
		type: "audio/mpeg",
		kind: "audio",
		test: (b) => ascii(b, 0, 3) === "ID3" || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0),
	},
	{ type: "video/mp4", kind: "video", test: (b) => ascii(b, 4, 8) === "ftyp" },
	{
		type: "video/webm",
		kind: "video",
		test: (b) => b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3,
	},
];

function ascii(bytes: Uint8Array, from: number, to: number): string {
	return String.fromCharCode(...bytes.subarray(from, to));
}

/** by the bytes alone, never a type the row claims, and never anything a page can run */
export function sniffMedia(bytes: Uint8Array, kind: ReviewFieldType): string | undefined {
	const found = SIGNATURES.find((s) => s.test(bytes));
	if (!found) return undefined;
	// an mp4 or webm container holds audio as often as video
	if (kind === "audio" && found.kind === "video") return found.type.replace("video/", "audio/");
	return found.kind === kind || (kind === "video" && found.kind === "audio")
		? found.type
		: undefined;
}

function parquetTarget(review: MlReview, file: string): ParquetTarget | undefined {
	const source = review.source;
	if (source.kind === "dataset") {
		return {
			repo: { type: "dataset", name: source.repo },
			path: file,
			...(source.revision ? { revision: source.revision } : {}),
		};
	}
	if (source.kind !== "parquet") return undefined;
	const uri = parseHfUri(source.uri);
	if (!uri) return undefined;
	const repo: RepoDesignation = {
		type: uri.type === "buckets" ? "bucket" : "dataset",
		name: `${uri.owner}/${uri.name}`,
	};
	return { repo, path: file, ...(source.revision ? { revision: source.revision } : {}) };
}

export async function reviewMedia(
	review: MlReview,
	index: number,
	fieldName: string,
	access: HubAccess
): Promise<MediaOutcome> {
	const record = Number.isInteger(index) ? review.records[index] : undefined;
	if (!record) return missing("No such record in this review.");
	const field = review.schema.fields.find((f) => f.name === fieldName);
	if (!field || !record.media?.includes(field.name) || !record.origin) {
		return missing("This field has no media to load.");
	}
	const column = columnOf(field);
	const source = review.source;
	try {
		if (source.kind === "dataset" && source.via === "viewer") {
			if (record.origin.row === undefined) return missing("No row to read from.");
			const kept = review.mediaLinks?.[index]?.[field.name];
			if (usableLink(kept, Date.now())) return { redirect: kept };
			const links = await resignLinks(review, access);
			const src = links[index]?.[field.name];
			if (!src)
				return missing(
					"The dataset row has no media in this field, or the viewer sent an unexpected link."
				);
			return { redirect: src, links };
		}
		const file = record.origin.file;
		const target = file ? parquetTarget(review, file) : undefined;
		if (!target || record.origin.fileRow === undefined) return missing("No file to read from.");
		const cell = await readMediaCell(target, record.origin.fileRow, column, access);
		const bytes = isObject(cell) ? cell.bytes : undefined;
		if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
			return missing("The row stores no bytes for this field.");
		}
		const contentType = sniffMedia(bytes, field.type);
		if (!contentType)
			return { status: 415, message: `Not a ${field.type} format the pane can show.` };
		return { bytes, contentType };
	} catch (err) {
		if (err instanceof ViewerError)
			return { status: err.status === 429 ? 429 : 502, message: err.message };
		if (err instanceof ParquetReadError) return { status: 502, message: err.message };
		return { status: 502, message: "The media could not be read." };
	}
}
