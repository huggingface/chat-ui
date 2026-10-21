import { datasetInfo, HubApiError, type RepoDesignation } from "@huggingface/hub";
import type {
	ReviewDatasetVia,
	ReviewField,
	ReviewRecordOrigin,
	ReviewSample,
	ReviewSampleMethod,
	ReviewSource,
} from "$lib/types/MlReview";
import { parseHfUri } from "$lib/server/mlRegistry/hubUri";
import {
	REVIEW_MAX_BYTES,
	REVIEW_MAX_RECORDS,
} from "$lib/server/textGeneration/builtinTools/requestReviewDefinition";
import {
	pickSplit,
	viewerSplitRows,
	viewerSplits,
	viewerWindow,
	ViewerError,
	type HubAccess,
	type RowQuery,
	type ViewerRow,
} from "./datasetViewer";
import {
	cellValue,
	columnOf,
	columnType,
	deriveFields,
	isMediaType,
	type ColumnType,
	type DatasetColumn,
} from "./features";
import { lineFormat, sampleLines, type LineFormat } from "./lineSource";
import {
	groupsOf,
	listDataFiles,
	listFolders,
	openParquet,
	parquetColumns,
	ParquetReadError,
	planBytes,
	readSegment,
	ReadBudget,
	segmentsOf,
	type OpenParquet,
	type Segment,
} from "./parquetSource";
import {
	headWindow,
	mapPool,
	randomSeed,
	randomWindows,
	seededRandom,
	splitWindows,
	type RowWindow,
} from "./sampling";

export const TABLE_DEFAULT_ROWS = 50;
/** each a rows call or a run of parquet rows */
export const TABLE_MAX_WINDOWS = 20;
const VIEWER_CONCURRENCY = 8;
const PARQUET_CONCURRENCY = 4;
const MAX_REFETCHES = 50;
const MAX_FILTER_CHARS = 2_000;
/** short, a slow viewer falls back to the files rather than holding the turn */
const VIEWER_TIMEOUT_MS = 8_000;
const VIEWER_FILTER_TIMEOUT_MS = 5_000;
/** the whole viewer attempt, every call together, so a slow viewer never holds a read */
const VIEWER_BUDGET_MS = 10_000;
/** a random parquet sample reads at most this many row groups */
const PARQUET_RANDOM_GROUPS = 5;
const PARQUET_MAX_LINE_FILES = 100;
/** the viewer conversion, a branch the hub serves without the viewer */
export const CONVERTED_REVISION = "refs/convert/parquet";

export interface SampleSpec {
	method: ReviewSampleMethod;
	rows: number;
	offset?: number;
	seed?: number;
	where?: string;
	query?: string;
}

export type TableInput =
	| {
			dataset: { repo: string; config?: string; split?: string; revision?: string };
			sample: SampleSpec;
	  }
	| { parquet: { uri: string }; sample: SampleSpec };

const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const REPO = /^[\w.-]+\/[\w.-]+$/;

function parseSample(
	value: Record<string, unknown>,
	at: string,
	viewer: boolean
): SampleSpec | { error: string } {
	const method = value.sample ?? "head";
	if (method !== "head" && method !== "random") {
		return { error: `${at}.sample must be "head" or "random"` };
	}
	const rows = value.rows ?? TABLE_DEFAULT_ROWS;
	if (
		typeof rows !== "number" ||
		!Number.isInteger(rows) ||
		rows < 1 ||
		rows > REVIEW_MAX_RECORDS
	) {
		return { error: `${at}.rows must be a whole number from 1 to ${REVIEW_MAX_RECORDS}` };
	}
	const spec: SampleSpec = { method, rows };
	for (const key of ["offset", "seed"] as const) {
		const n = value[key];
		if (n === undefined) continue;
		if (typeof n !== "number" || !Number.isInteger(n) || n < 0) {
			return { error: `${at}.${key} must be a whole number of 0 or more` };
		}
		spec[key] = n;
	}
	if (spec.offset !== undefined && method !== "head") {
		return { error: `${at}.offset is for sample "head"; a random sample takes a seed` };
	}
	for (const key of ["where", "query"] as const) {
		const text = value[key];
		if (text === undefined) continue;
		if (!viewer) {
			return { error: `${at}.${key} needs the dataset viewer; use source.dataset` };
		}
		if (typeof text !== "string" || !text.trim() || text.length > MAX_FILTER_CHARS) {
			return { error: `${at}.${key} must be text of at most ${MAX_FILTER_CHARS} characters` };
		}
		spec[key] = text.trim();
	}
	if (spec.where !== undefined && spec.query !== undefined) {
		return { error: `${at} takes where or query, not both` };
	}
	return spec;
}

export function parseTableInput(key: "dataset" | "parquet", value: unknown) {
	const at = `source.${key}`;
	if (key === "parquet" && typeof value === "string") value = { uri: value };
	if (!isObject(value)) {
		return {
			error:
				key === "dataset"
					? `${at} must be {"repo", "config"?, "split"?, "sample"?, "rows"?}`
					: `${at} must be an hf:// URI or {"uri", "sample"?, "rows"?}`,
		};
	}
	const sample = parseSample(value, at, key === "dataset");
	if ("error" in sample) return sample;
	if (key === "dataset") {
		const repo = typeof value.repo === "string" ? value.repo.trim().replace(/^datasets\//, "") : "";
		if (!REPO.test(repo)) return { error: `${at}.repo must be a dataset id like "org/name"` };
		for (const name of ["config", "split", "revision"] as const) {
			if (value[name] !== undefined && (typeof value[name] !== "string" || !value[name])) {
				return { error: `${at}.${name} must be a name` };
			}
		}
		return {
			dataset: {
				repo,
				...(typeof value.config === "string" ? { config: value.config } : {}),
				...(typeof value.split === "string" ? { split: value.split } : {}),
				...(typeof value.revision === "string" ? { revision: value.revision } : {}),
			},
			sample,
		} satisfies TableInput;
	}
	const uri = typeof value.uri === "string" ? value.uri.trim() : "";
	const parsed = parseHfUri(uri);
	if (!parsed || (parsed.type !== "datasets" && parsed.type !== "buckets")) {
		return {
			error: `${at} must be an hf://datasets/... or hf://buckets/... Parquet file or folder`,
		};
	}
	return { parquet: { uri }, sample } satisfies TableInput;
}

export interface LoadedTable {
	ok: true;
	fields: ReviewField[];
	idField: string;
	records: Record<string, unknown>[];
	origins: ReviewRecordOrigin[];
	/** no stored value, the media route serves them */
	media: string[];
	source: ReviewSource;
}

type Loaded = LoadedTable | { ok: false; error: string };

interface ResolvedFields {
	fields: ReviewField[];
	kinds: Map<string, ColumnType | undefined>;
	media: string[];
	idColumn?: string;
	idField: string;
}

const listColumns = (columns: DatasetColumn[]) =>
	columns
		.slice(0, 40)
		.map((c) => c.name)
		.join(", ") + (columns.length > 40 ? ", ..." : "");

function resolveFields(
	columns: DatasetColumn[],
	declared: ReviewField[] | undefined,
	idField: string | undefined,
	where: string
): ResolvedFields | { error: string } {
	const byName = new Map(columns.map((c) => [c.name, c]));
	let idColumn: string | undefined;
	if (idField !== undefined) {
		if (!byName.has(idField)) {
			return {
				error: `id_field "${idField}" is not a column of ${where}; its columns are ${listColumns(columns)}. Omit id_field to number records by row`,
			};
		}
		idColumn = idField;
	} else if (byName.has("id")) {
		idColumn = "id";
	}

	let fields: ReviewField[];
	if (declared) {
		fields = declared;
	} else {
		const derived = deriveFields(columns, idColumn);
		if (derived.fields.length === 0) {
			return { error: `${where} has no column a review can show (${derived.skipped.join(", ")})` };
		}
		fields = derived.fields;
	}

	const kinds = new Map<string, ColumnType | undefined>();
	const media: string[] = [];
	for (const field of fields) {
		const name = columnOf(field);
		const column = byName.get(name);
		if (!column) {
			return {
				error: `field ${field.name} reads column "${name}", which ${where} does not have; its columns are ${listColumns(columns)}. Give the column as the field's column when the names differ`,
			};
		}
		const kind = columnType(column.feature);
		kinds.set(field.name, kind);
		const stored = kind && isMediaType(kind.type);
		if (stored && field.type !== kind.type && !(kind.anyMedia && isMediaType(field.type))) {
			return {
				error: `column "${name}" holds ${kind.type}, declare field ${field.name} as ${kind.type}`,
			};
		}
		if (stored) media.push(field.name);
		else if (isMediaType(field.type) && kind?.type !== "text") {
			return {
				error: `column "${name}" is not ${field.type} data or a URL, so field ${field.name} cannot show it as ${field.type}`,
			};
		}
	}
	return { fields, kinds, media, idField: idField ?? "id", ...(idColumn ? { idColumn } : {}) };
}

function buildRecords(
	rows: { row: Record<string, unknown>; origin: ReviewRecordOrigin }[],
	resolved: ResolvedFields
): Pick<LoadedTable, "records" | "origins"> {
	const records = rows.map(({ row, origin }) => {
		const record: Record<string, unknown> = {
			[resolved.idField]:
				resolved.idColumn !== undefined
					? cellValue("text", row[resolved.idColumn])
					: origin.row !== undefined
						? String(origin.row)
						: `${origin.file ?? ""}@${origin.byte ?? 0}`,
		};
		for (const field of resolved.fields) {
			// stored media loads through the media route, a url column keeps its url
			if (resolved.media.includes(field.name)) continue;
			const value = cellValue(field.type, row[columnOf(field)], resolved.kinds.get(field.name));
			if (value !== undefined) record[field.name] = value;
		}
		return record;
	});
	return { records, origins: rows.map((r) => r.origin) };
}

function tooBig(records: Record<string, unknown>[], where: string): string | undefined {
	const bytes = Buffer.byteLength(JSON.stringify(records), "utf8");
	return bytes > REVIEW_MAX_BYTES
		? `${records.length} rows of ${where} are ${bytes.toLocaleString("en-US")} bytes; a review holds at most ${REVIEW_MAX_BYTES / 1024 / 1024} MB. Sample fewer rows or declare fewer fields`
		: undefined;
}

function windowsFor(sample: SampleSpec, total: number, seed: number): RowWindow[] {
	return sample.method === "head"
		? headWindow(total, sample.rows, sample.offset)
		: randomWindows(total, sample.rows, TABLE_MAX_WINDOWS, seed);
}

const describeError = (err: unknown) => (err instanceof Error ? err.message : String(err));

async function readRevision(
	repo: string,
	access: HubAccess,
	revision?: string
): Promise<string | undefined> {
	try {
		const info = await datasetInfo({
			name: repo,
			additionalFields: ["sha"],
			...(revision ? { revision } : {}),
			...(access.token ? { accessToken: access.token } : {}),
			...(access.fetch ? { fetch: access.fetch } : {}),
		});
		return info.sha;
	} catch {
		return undefined;
	}
}

async function loadFromViewer(
	input: Extract<TableInput, { dataset: unknown }>,
	declared: ReviewField[] | undefined,
	idField: string | undefined,
	access: HubAccess
): Promise<Loaded | { fallback: string }> {
	const { repo } = input.dataset;
	const filtered = input.sample.where !== undefined || input.sample.query !== undefined;
	const budget = AbortSignal.timeout(VIEWER_BUDGET_MS);
	const viewer = {
		...access,
		signal: access.signal ? AbortSignal.any([access.signal, budget]) : budget,
		timeoutMs: filtered ? VIEWER_FILTER_TIMEOUT_MS : VIEWER_TIMEOUT_MS,
	};
	// filter and search have nothing else to run on, everything else can fall back to the files
	const unavailable = (err: unknown): Loaded | { fallback: string } => {
		if (access.signal?.aborted) return { ok: false, error: "Aborted by user" };
		const reason = viewerReason(err);
		return filtered
			? {
					ok: false,
					error: `the dataset viewer could not ${input.sample.where !== undefined ? "filter" : "search"} ${repo}: ${reason}. where and query need the viewer; sample without them (that reads the dataset's files), or filter in a job or sandbox that writes the rows to a file and pass source.sandbox or source.hub`,
				}
			: { fallback: reason };
	};
	if (input.dataset.revision && input.dataset.revision !== "main") {
		if (filtered) {
			return {
				ok: false,
				error: `where and query read the latest commit through the dataset viewer, not revision ${input.dataset.revision}`,
			};
		}
		return {
			fallback: `revision ${input.dataset.revision} was asked for, the viewer serves the latest commit only`,
		};
	}
	const revision = readRevision(repo, access);
	let target: RowQuery;
	let total: number;
	let first: Awaited<ReturnType<typeof viewerWindow>> | undefined;
	try {
		const picked = pickSplit(
			await viewerSplits(repo, viewer),
			repo,
			input.dataset.config,
			input.dataset.split
		);
		if ("error" in picked) return { ok: false, error: picked.error };
		target = {
			dataset: repo,
			...picked,
			...(input.sample.where !== undefined ? { where: input.sample.where } : {}),
			...(input.sample.query !== undefined ? { query: input.sample.query } : {}),
		};
		if (target.where !== undefined || target.query !== undefined) {
			// the filtered count only comes back with a page of rows
			first = await viewerWindow(target, { offset: 0, length: 1 }, viewer);
			total = first.total ?? first.rows.length;
		} else {
			total = await viewerSplitRows(repo, picked.config, picked.split, viewer);
		}
	} catch (err) {
		return unavailable(err);
	}
	const where = `${repo} (${target.config}/${target.split})`;
	if (total === 0) {
		return {
			ok: false,
			error: `${where} has no rows${target.where ? ` where ${target.where}` : target.query ? ` matching "${target.query}"` : ""}`,
		};
	}

	const seed = input.sample.seed ?? randomSeed();
	const windows = windowsFor(input.sample, total, seed);
	let pages: ViewerRow[][];
	let columns: DatasetColumn[];
	try {
		const fetched = await mapPool(splitWindows(windows), VIEWER_CONCURRENCY, (w) =>
			viewerWindow(target, w, viewer)
		);
		pages = fetched.map((p) => p.rows);
		columns = fetched.find((p) => p.columns.length)?.columns ?? first?.columns ?? [];
	} catch (err) {
		return unavailable(err);
	}
	const resolved = resolveFields(columns, declared, idField, where);
	if ("error" in resolved) return { ok: false, error: resolved.error };

	const rows = pages.flat();
	if (rows.length === 0) return { ok: false, error: `${where} returned no rows at those offsets` };
	const shown = new Set(
		resolved.fields.filter((f) => !resolved.media.includes(f.name)).map(columnOf)
	);
	const truncated = rows
		.filter((r) => r.truncated_cells?.some((cell) => shown.has(cell)))
		.slice(0, MAX_REFETCHES);
	if (truncated.length > 0) {
		// a page holding a large row comes back cut short, the same row alone usually does not
		try {
			const whole = await mapPool(truncated, VIEWER_CONCURRENCY, (r) =>
				viewerWindow(
					{ ...target, where: undefined, query: undefined },
					{ offset: r.row_idx, length: 1 },
					viewer
				)
			);
			for (const [i, r] of truncated.entries()) {
				const fresh = whole[i].rows[0];
				if (fresh) Object.assign(r, fresh);
			}
		} catch {
			// a cut cell still reviews, shorter
		}
	}

	const built = buildRecords(
		rows.map((r) => ({ row: r.row, origin: { row: r.row_idx } })),
		resolved
	);
	const big = tooBig(built.records, where);
	if (big) return { ok: false, error: big };
	const sha = await revision;
	const sample: ReviewSample = {
		method: input.sample.method,
		rows: built.records.length,
		total,
		...(input.sample.method === "head"
			? { offset: input.sample.offset ?? 0 }
			: { seed, windows: windows.length }),
		...(target.where !== undefined ? { where: target.where } : {}),
		...(target.query !== undefined ? { query: target.query } : {}),
	};
	return {
		ok: true,
		fields: resolved.fields,
		idField: resolved.idField,
		media: resolved.media,
		...built,
		source: {
			kind: "dataset",
			repo,
			config: target.config,
			split: target.split,
			...(sha ? { revision: sha } : {}),
			via: "viewer",
			sample,
		},
	};
}

const SPLIT_TOKEN = (split: string) =>
	new RegExp(`(^|[/_-])${split.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([/_.-]|$)`);

/** a guess from the paths, without the viewer there is no split list */
function filesForSplit(paths: string[], config?: string, split?: string): string[] {
	let picked = paths;
	if (config && config !== "default") {
		const inConfig = picked.filter((p) => p.split("/").includes(config));
		if (inConfig.length) picked = inConfig;
	}
	const wanted = split ?? "train";
	const inSplit = picked.filter((p) => SPLIT_TOKEN(wanted).test(p));
	return inSplit.length || split ? inSplit : picked;
}

interface ParquetLoad {
	repo: RepoDesignation;
	paths: string[];
	revision?: string;
	sample: SampleSpec;
	declared?: ReviewField[];
	idField?: string;
	where: string;
	access: HubAccess;
	/** set without the viewer, media would mean reading whole row groups of bytes */
	mediaRefusal?: string;
}

type ParquetLoaded =
	| { ok: false; error: string }
	| (Omit<LoadedTable, "source"> & { sample: ReviewSample; files: string[] });

/** row groups are the unit a read pays for, so a random sample stays inside a few */
function groupedSegments(
	files: OpenParquet[],
	rows: number,
	seed: number,
	cost: (segment: Segment) => number,
	left: number
): { segments: Segment[]; picks: number[][]; groups: number } | undefined {
	const random = seededRandom(seed);
	const all = files.flatMap((file) =>
		groupsOf(file.metadata).map((group) => ({
			file,
			from: group.start,
			to: group.start + group.rows,
		}))
	);
	for (let i = all.length - 1; i > 0; i -= 1) {
		const j = Math.floor(random() * (i + 1));
		[all[i], all[j]] = [all[j], all[i]];
	}
	const chosen: Segment[] = [];
	let bytes = 0;
	let held = 0;
	for (const segment of all) {
		if (chosen.length >= PARQUET_RANDOM_GROUPS && held >= rows) break;
		const price = cost(segment);
		if (bytes + price > left) continue;
		chosen.push(segment);
		bytes += price;
		held += segment.to - segment.from;
	}
	if (chosen.length === 0) return undefined;

	const quotas = chosen.map(() => 0);
	for (let remaining = Math.min(rows, held), i = 0; remaining > 0; i = (i + 1) % chosen.length) {
		if (quotas[i] < chosen[i].to - chosen[i].from) {
			quotas[i] += 1;
			remaining -= 1;
		}
	}
	const picks = chosen.map((segment, i) => {
		const size = segment.to - segment.from;
		const taken = new Set<number>();
		while (taken.size < quotas[i]) taken.add(Math.floor(random() * size));
		return [...taken].sort((a, b) => a - b);
	});
	const segments = chosen.map((segment, i) => ({
		...segment,
		from: segment.from + (picks[i][0] ?? 0),
		to: segment.from + (picks[i][picks[i].length - 1] ?? 0) + 1,
	}));
	return {
		segments,
		picks: picks.map((p) => p.map((local) => local - (p[0] ?? 0))),
		groups: chosen.length,
	};
}

async function loadFromParquet({
	repo,
	paths,
	revision,
	sample,
	declared,
	idField,
	where,
	access,
	mediaRefusal,
}: ParquetLoad): Promise<ParquetLoaded> {
	const budget = new ReadBudget();
	const open = (path: string) =>
		openParquet({ repo, path, ...(revision ? { revision } : {}) }, access, budget);
	let files: OpenParquet[];
	let resolved: ResolvedFields;
	try {
		// the first footer settles the columns, so a refusal costs one file and not all of them
		const first = await open(paths[0]);
		const fields = resolveFields(parquetColumns(first.metadata), declared, idField, where);
		if ("error" in fields) return { ok: false, error: fields.error };
		if (mediaRefusal && fields.media.length > 0) {
			return {
				ok: false,
				error: `${where} has ${fields.media.join(", ")} media, which the pane loads only through the dataset viewer, and ${mediaRefusal}. Declare fields without the media, or sample it in a job or sandbox that writes the rows and media links to a file and pass source.sandbox or source.hub; do not wait for the viewer`,
			};
		}
		resolved = fields;
		const opened = [first, ...(await mapPool(paths.slice(1), VIEWER_CONCURRENCY, open))];
		let start = 0;
		files = opened.map((file) => {
			const placed = { ...file, start };
			start += file.rows;
			return placed;
		});
	} catch (err) {
		return { ok: false, error: readFailure(err, where) };
	}
	const total = files.reduce((sum, f) => sum + f.rows, 0);
	if (total === 0) return { ok: false, error: `${where} has no rows` };
	const mediaColumns = new Set(
		resolved.fields.filter((f) => resolved.media.includes(f.name)).map(columnOf)
	);
	const dataColumns = new Set([
		...resolved.fields.filter((f) => !resolved.media.includes(f.name)).map(columnOf),
		...(resolved.idColumn ? [resolved.idColumn] : []),
	]);
	const left = budget.limit - budget.bytes;
	const tooMuch = (planned: number) => ({
		ok: false as const,
		error: `${sample.rows} rows of ${where} would need about ${Math.ceil(planned / 1024 / 1024)} MB of range reads (row groups hold ${Math.round(files[0].rows / Math.max(1, files[0].metadata.row_groups.length))} rows here), past the ${budget.limit / 1024 / 1024} MB a review may read. Sample fewer rows or declare fewer fields${mediaColumns.size ? ", or use source.dataset so media comes from the dataset viewer" : ""}`,
	});

	const seed = sample.seed ?? randomSeed();
	let segments: Segment[];
	let picks: number[][] | undefined;
	let groups: number | undefined;
	if (sample.method === "random") {
		const grouped = groupedSegments(
			files,
			sample.rows,
			seed,
			(segment) => planBytes([segment], dataColumns, mediaColumns),
			left
		);
		if (!grouped) {
			const smallest = Math.min(
				...files.flatMap((file) =>
					groupsOf(file.metadata).map((g) =>
						planBytes([{ file, from: g.start, to: g.start + g.rows }], dataColumns, mediaColumns)
					)
				)
			);
			return tooMuch(smallest);
		}
		({ segments, picks, groups } = grouped);
	} else {
		segments = segmentsOf(files, headWindow(total, sample.rows, sample.offset));
		const planned = planBytes(segments, dataColumns, mediaColumns);
		if (planned > left) return tooMuch(planned);
	}

	let read: Record<string, unknown>[][];
	try {
		read = await mapPool(segments, PARQUET_CONCURRENCY, (segment) =>
			readSegment(segment, [...dataColumns])
		);
	} catch (err) {
		if (err instanceof ParquetReadError) return { ok: false, error: err.message };
		return { ok: false, error: readFailure(err, where) };
	}
	const rows = segments.flatMap((segment, i) => {
		const wanted = picks?.[i] ?? read[i].map((_, j) => j);
		return wanted.map((j) => {
			const fileRow = segment.from + j;
			return {
				row: read[i][j],
				origin: { row: segment.file.start + fileRow, file: segment.file.path, fileRow },
			};
		});
	});
	const built = buildRecords(rows, resolved);
	const big = tooBig(built.records, where);
	if (big) return { ok: false, error: big };
	return {
		ok: true,
		fields: resolved.fields,
		idField: resolved.idField,
		media: resolved.media,
		...built,
		files: files.map((f) => f.path),
		sample: {
			method: sample.method,
			rows: built.records.length,
			total,
			...(sample.method === "head" ? { offset: sample.offset ?? 0 } : { seed, groups }),
		},
	};
}

function viewerReason(err: unknown): string {
	if (err instanceof ViewerError) return err.message.slice(0, 200);
	if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
		return "the dataset viewer did not answer in time";
	}
	return "the dataset viewer could not be reached";
}

/** a gated dataset lists its files to anyone and refuses their bytes */
function readFailure(err: unknown, where: string): string {
	const status = err instanceof HubApiError ? err.statusCode : undefined;
	if (status === 401 || status === 403) {
		return `the signed in user cannot read the files of ${where}: it is gated or private. Ask the user to accept its terms on its Hub page (their sign in must also allow gated repos), then try again`;
	}
	if (status === 404) return `${where} has a file that does not exist any more; try again`;
	return `Could not read ${where}: ${describeError(err)}`;
}

function hubError(err: unknown, repo: string): string {
	const status = err instanceof HubApiError ? err.statusCode : undefined;
	if (status === 401 || status === 403 || status === 404) {
		return `${repo} cannot be read: it does not exist, or it is private or gated and the signed in user has no access to it`;
	}
	return `Could not list the files of ${repo}: ${describeError(err)}`;
}

/** partial when only the first part of a large split was converted */
async function findConverted(
	repo: RepoDesignation,
	config: string | undefined,
	split: string | undefined,
	access: HubAccess
): Promise<{ config: string; split: string; folder: string; partial: boolean } | undefined> {
	try {
		const configs = (await listFolders(repo, "", CONVERTED_REVISION, access)).map((f) =>
			f.split("/").pop()
		);
		const chosen = config ?? (configs.includes("default") ? "default" : configs[0]);
		if (!chosen || !configs.includes(chosen)) return undefined;
		const folders = (await listFolders(repo, chosen, CONVERTED_REVISION, access)).map(
			(f) => f.split("/").pop() ?? ""
		);
		const splits = folders.map((f) => f.replace(/^partial-/, ""));
		const wanted = split ?? (splits.includes("train") ? "train" : splits[0]);
		const index = splits.indexOf(wanted ?? "");
		if (index < 0 || !wanted) return undefined;
		return {
			config: chosen,
			split: wanted,
			folder: `${chosen}/${folders[index]}`,
			partial: folders[index].startsWith("partial-"),
		};
	} catch {
		return undefined;
	}
}

/** parquet at the revision, then the converted branch, then jsonl or csv, else a sandbox */
async function loadFromFiles(
	input: Extract<TableInput, { dataset: unknown }>,
	declared: ReviewField[] | undefined,
	idField: string | undefined,
	access: HubAccess,
	viewerError: string
): Promise<Loaded> {
	const { repo, config, split } = input.dataset;
	const revision = input.dataset.revision ?? "main";
	const designation: RepoDesignation = { type: "dataset", name: repo };
	const sha = readRevision(repo, access, revision);
	const mediaRefusal = `the viewer is unavailable (${viewerError})`;
	const dataset = (via: ReviewDatasetVia, read: string | undefined, extra: object = {}) => ({
		kind: "dataset" as const,
		repo,
		config: config ?? "default",
		split: split ?? "train",
		...(read ? { revision: read } : {}),
		via,
		viewerError,
		...extra,
	});

	let listed: string[];
	try {
		listed = await listDataFiles(designation, "", revision, access, /\.(parquet|jsonl|csv|tsv)$/i);
	} catch (err) {
		return { ok: false, error: hubError(err, repo) };
	}

	const parquet = filesForSplit(
		listed.filter((p) => p.endsWith(".parquet")),
		config,
		split
	);
	if (parquet.length > 0) {
		const loaded = await loadFromParquet({
			repo: designation,
			paths: parquet,
			revision,
			sample: input.sample,
			declared,
			idField,
			where: `${repo} (Parquet files at ${revision})`,
			access,
			mediaRefusal,
		});
		if (!loaded.ok) return loaded;
		const { sample, files, ...rest } = loaded;
		return { ...rest, source: { ...dataset("parquet", (await sha) ?? revision), files, sample } };
	}

	// the conversion follows main, so it may hold other rows than a pinned revision
	const pinned = revision !== "main";
	const converted = pinned ? undefined : await findConverted(designation, config, split, access);
	if (converted) {
		let paths: string[];
		try {
			paths = await listDataFiles(designation, converted.folder, CONVERTED_REVISION, access);
		} catch (err) {
			return { ok: false, error: hubError(err, repo) };
		}
		if (paths.length > 0) {
			const loaded = await loadFromParquet({
				repo: designation,
				paths,
				revision: CONVERTED_REVISION,
				sample: input.sample,
				declared,
				idField,
				where: `${repo} (${CONVERTED_REVISION} ${converted.folder})`,
				access,
				mediaRefusal,
			});
			if (!loaded.ok) return loaded;
			const { sample, files, ...rest } = loaded;
			return {
				...rest,
				source: {
					...dataset("converted", CONVERTED_REVISION, converted.partial ? { partial: true } : {}),
					config: converted.config,
					split: converted.split,
					files,
					sample,
				},
			};
		}
	}

	const lines = filesForSplit(
		listed.filter((p) => lineFormat(p)),
		config,
		split
	);
	const format = lines[0] ? lineFormat(lines[0]) : undefined;
	if (format) {
		return loadFromLines(
			designation,
			lines.filter((p) => lineFormat(p) === format),
			format,
			revision,
			input.sample,
			declared,
			idField,
			access,
			(sample, files) => ({ ...dataset(format, revision), files, sample })
		);
	}

	return {
		ok: false,
		error: `${repo} could not be read without a job: ${viewerError}, and at ${revision} it has no Parquet, JSONL or CSV files${split ? ` for split ${split}` : ""} and no ${CONVERTED_REVISION} conversion. Sample it in a job or sandbox that writes the rows to a file and pass source.sandbox or source.hub; do not wait for the viewer`,
	};
}

async function loadFromLines(
	repo: RepoDesignation,
	paths: string[],
	format: LineFormat,
	revision: string,
	sample: SampleSpec,
	declared: ReviewField[] | undefined,
	idField: string | undefined,
	access: HubAccess,
	source: (sample: ReviewSample, files: string[]) => ReviewSource
): Promise<Loaded> {
	const where = `${paths.length === 1 ? paths[0] : `${paths.length} ${format} files`} at ${revision}`;
	const seed = sample.seed ?? randomSeed();
	let sampled: Awaited<ReturnType<typeof sampleLines>>;
	try {
		sampled = await sampleLines({
			repo,
			paths: paths.slice(0, PARQUET_MAX_LINE_FILES),
			revision,
			format,
			method: sample.method,
			rows: sample.rows,
			...(sample.offset !== undefined ? { offset: sample.offset } : {}),
			seed,
			maxWindows: TABLE_MAX_WINDOWS,
			access,
			budget: new ReadBudget(),
		});
	} catch (err) {
		return { ok: false, error: readFailure(err, where) };
	}
	if (sampled.rows.length === 0) return { ok: false, error: `${where} gave no readable rows` };
	const resolved = resolveFields(sampled.columns, declared, idField, where);
	if ("error" in resolved) return { ok: false, error: resolved.error };
	const built = buildRecords(sampled.rows, resolved);
	const big = tooBig(built.records, where);
	if (big) return { ok: false, error: big };
	return {
		ok: true,
		fields: resolved.fields,
		idField: resolved.idField,
		media: resolved.media,
		...built,
		source: source(
			{
				method: sample.method,
				rows: built.records.length,
				bytes: sampled.bytes,
				...(sample.method === "head"
					? { offset: sample.offset ?? 0 }
					: { seed, windows: sampled.windows, approximate: true as const }),
			},
			paths
		),
	};
}

export async function loadTable(
	input: TableInput,
	{ fields, idField, access }: { fields?: ReviewField[]; idField?: string; access: HubAccess }
): Promise<Loaded> {
	if ("dataset" in input) {
		const viewed = await loadFromViewer(input, fields, idField, access);
		if (!("fallback" in viewed)) return viewed;
		return loadFromFiles(input, fields, idField, access, viewed.fallback);
	}

	const uri = parseHfUri(input.parquet.uri);
	if (!uri || (uri.type !== "datasets" && uri.type !== "buckets")) {
		return {
			ok: false,
			error: "source.parquet must be an hf://datasets/... or hf://buckets/... URI",
		};
	}
	const designation: RepoDesignation = {
		type: uri.type === "buckets" ? "bucket" : "dataset",
		name: `${uri.owner}/${uri.name}`,
	};
	let paths: string[];
	if (uri.path?.endsWith(".parquet")) {
		paths = [uri.path];
	} else {
		try {
			paths = await listDataFiles(designation, uri.path ?? "", uri.revision, access);
		} catch (err) {
			return { ok: false, error: `Could not list ${input.parquet.uri}: ${describeError(err)}` };
		}
		if (paths.length === 0)
			return { ok: false, error: `${input.parquet.uri} holds no .parquet files` };
		if (paths.length > 100) {
			return {
				ok: false,
				error: `${input.parquet.uri} holds more than 100 Parquet files; point at a narrower folder or one file`,
			};
		}
	}
	const loaded = await loadFromParquet({
		repo: designation,
		paths,
		...(uri.revision ? { revision: uri.revision } : {}),
		sample: input.sample,
		declared: fields,
		idField,
		where: input.parquet.uri,
		access,
	});
	if (!loaded.ok) return loaded;
	const { sample, files, ...rest } = loaded;
	return {
		...rest,
		source: {
			kind: "parquet",
			uri: input.parquet.uri,
			files,
			...(uri.revision ? { revision: uri.revision } : {}),
			sample,
		},
	};
}
