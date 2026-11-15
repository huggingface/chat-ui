import type { DatasetColumn } from "./features";
import type { RowWindow } from "./sampling";

export const DATASET_VIEWER_URL = "https://datasets-server.huggingface.co";
const TIMEOUT_MS = 30_000;

export interface HubAccess {
	/** the owner token, private and gated datasets need it */
	token?: string;
	fetch?: typeof fetch;
	signal?: AbortSignal;
	/** per viewer call, short so a slow viewer falls back to the files */
	timeoutMs?: number;
}

export class ViewerError extends Error {
	constructor(
		message: string,
		readonly status: number,
		/** the viewer has not processed the dataset but its files may still be read */
		readonly notReady = false
	) {
		super(message);
	}
}

export interface ViewerRow {
	row_idx: number;
	row: Record<string, unknown>;
	truncated_cells?: string[];
}

export interface ViewerPage {
	columns: DatasetColumn[];
	rows: ViewerRow[];
	total?: number;
}

export function accessSignal(signal?: AbortSignal, ms = TIMEOUT_MS): AbortSignal {
	const timeout = AbortSignal.timeout(ms);
	return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

const NOT_READY =
	/not ready|not supported|has not been|is too big|cannot be|no parquet|not available|does not support|currently being/i;

async function viewerGet(
	endpoint: string,
	params: Record<string, string | number>,
	access: HubAccess
): Promise<Record<string, unknown>> {
	const url = new URL(`${DATASET_VIEWER_URL}/${endpoint}`);
	for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
	const res = await (access.fetch ?? fetch)(url, {
		headers: {
			Accept: "application/json",
			...(access.token ? { Authorization: `Bearer ${access.token}` } : {}),
		},
		signal: accessSignal(access.signal, access.timeoutMs),
	});
	const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
	if (res.ok) return body;
	const reason =
		typeof body.error === "string" ? body.error : `the dataset viewer answered HTTP ${res.status}`;
	const dataset = String(params.dataset);
	if (res.status === 401 || res.status === 403 || res.status === 404) {
		if (/split|config/i.test(reason) && !/dataset does not exist/i.test(reason)) {
			throw new ViewerError(reason, 404);
		}
		throw new ViewerError(
			`${dataset} cannot be read: it does not exist, or it is private or gated and the signed in user has no access to it`,
			404
		);
	}
	if (res.status === 429) {
		throw new ViewerError(
			"the dataset viewer is rate limiting these reads; sample fewer rows, or try again in a minute",
			429
		);
	}
	if (/invalid symbols/i.test(reason) && params.where !== undefined) {
		throw new ViewerError(
			`${reason}: quote column names in double quotes and strings in single quotes, e.g. "label" = 1 AND "lang" = 'en'`,
			400
		);
	}
	if (/index is loading/i.test(reason)) {
		throw new ViewerError(
			`${reason}: the viewer is still indexing ${dataset} for where and query; retry in a minute, or sample without them`,
			503
		);
	}
	throw new ViewerError(reason, res.status, res.status >= 500 && NOT_READY.test(reason));
}

const parseColumns = (body: Record<string, unknown>): DatasetColumn[] =>
	(Array.isArray(body.features) ? body.features : []).flatMap((feature) =>
		typeof feature === "object" && feature !== null && "name" in feature
			? [{ name: String(feature.name), feature: (feature as { type?: unknown }).type }]
			: []
	);

const parseRows = (body: Record<string, unknown>): ViewerRow[] =>
	(Array.isArray(body.rows) ? body.rows : []).filter(
		(row): row is ViewerRow =>
			typeof row === "object" &&
			row !== null &&
			typeof (row as ViewerRow).row_idx === "number" &&
			typeof (row as ViewerRow).row === "object"
	);

const page = (body: Record<string, unknown>): ViewerPage => ({
	columns: parseColumns(body),
	rows: parseRows(body),
	...(typeof body.num_rows_total === "number" ? { total: body.num_rows_total } : {}),
});

export async function viewerSplits(
	dataset: string,
	access: HubAccess
): Promise<{ config: string; split: string }[]> {
	const body = await viewerGet("splits", { dataset }, access);
	return (Array.isArray(body.splits) ? body.splits : []).flatMap((s) =>
		typeof s === "object" && s !== null && "config" in s && "split" in s
			? [{ config: String(s.config), split: String(s.split) }]
			: []
	);
}

export async function viewerSplitRows(
	dataset: string,
	config: string,
	split: string,
	access: HubAccess
): Promise<number> {
	const body = await viewerGet("size", { dataset, config }, access);
	const size = body.size as { splits?: { split?: string; num_rows?: number }[] } | undefined;
	const found = size?.splits?.find((s) => s.split === split);
	if (typeof found?.num_rows !== "number") {
		throw new ViewerError(`the dataset viewer has no row count for ${config}/${split}`, 500, true);
	}
	return found.num_rows;
}

export interface RowQuery {
	dataset: string;
	config: string;
	split: string;
	where?: string;
	query?: string;
}

export async function viewerWindow(
	target: RowQuery,
	window: RowWindow,
	access: HubAccess
): Promise<ViewerPage> {
	const base = {
		dataset: target.dataset,
		config: target.config,
		split: target.split,
		offset: window.offset,
		length: window.length,
	};
	if (target.where !== undefined) {
		return page(await viewerGet("filter", { ...base, where: target.where }, access));
	}
	if (target.query !== undefined) {
		return page(await viewerGet("search", { ...base, query: target.query }, access));
	}
	return page(await viewerGet("rows", base, access));
}

export function pickSplit(
	splits: { config: string; split: string }[],
	dataset: string,
	config?: string,
	split?: string
): { config: string; split: string } | { error: string } {
	const configs = [...new Set(splits.map((s) => s.config))];
	const chosenConfig = config ?? (configs.includes("default") ? "default" : configs[0]);
	if (!chosenConfig || !configs.includes(chosenConfig)) {
		return {
			error: `${dataset} has no config "${config}"; its configs are ${configs.join(", ") || "(none)"}`,
		};
	}
	const inConfig = splits.filter((s) => s.config === chosenConfig).map((s) => s.split);
	const chosenSplit = split ?? (inConfig.includes("train") ? "train" : inConfig[0]);
	if (!chosenSplit || !inConfig.includes(chosenSplit)) {
		return {
			error: `${dataset} config ${chosenConfig} has no split "${split}"; its splits are ${inConfig.join(", ") || "(none)"}`,
		};
	}
	return { config: chosenConfig, split: chosenSplit };
}
