import { logger } from "$lib/server/logger";

/**
 * Job/sandbox pricing for the budget gate.
 *
 * The Hub prices job hardware per minute (`GET /api/jobs/hardware`,
 * `unitCostMicroUSD`), and a job cannot outlive its timeout, so
 * `price × ceil(timeout / 60)` is a hard worst-case cost for a submission —
 * an upper bound, not an estimate. Everything here is integer micro-USD.
 */

const HARDWARE_API_URL = "https://huggingface.co/api/jobs/hardware";
const PRICE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;

/**
 * Snapshot of the hardware API (2026-08-31), micro-USD per minute. Used when
 * the live list is unreachable and no fetch has succeeded yet, so a Hub outage
 * degrades to slightly stale prices instead of blocking every submission. A
 * flavor in neither the live list nor this table fails closed at the gate.
 */
const FALLBACK_PRICES_MICRO_USD_PER_MINUTE: Record<string, number> = {
	"cpu-basic": 167,
	"cpu-upgrade": 500,
	"cpu-performance": 31_667,
	"cpu-xl": 16_667,
	"t4-small": 6_667,
	"t4-medium": 10_000,
	"a10g-small": 16_667,
	"a10g-large": 25_000,
	"a10g-largex2": 50_000,
	"a10g-largex4": 83_334,
	"a100-large": 41_667,
	a100x4: 166_667,
	a100x8: 333_333,
	h200: 83_333,
	h200x2: 166_667,
	h200x4: 333_333,
	h200x8: 666_667,
	"rtx-pro-6000": 45_833,
	"rtx-pro-6000x2": 91_667,
	"rtx-pro-6000x4": 183_333,
	"rtx-pro-6000x8": 366_667,
	l4x1: 13_333,
	l4x4: 63_333,
	l40sx1: 30_000,
	l40sx4: 138_333,
	l40sx8: 391_666,
};

let livePrices: Map<string, number> | undefined;
let lastFetchAt = 0;
let inflight: Promise<void> | undefined;

async function refreshLivePrices(): Promise<void> {
	const res = await fetch(HARDWARE_API_URL, {
		headers: { Accept: "application/json" },
		signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
	});
	if (!res.ok) throw new Error(`hardware API returned ${res.status}`);
	const body: unknown = await res.json();
	if (!Array.isArray(body)) throw new Error("hardware API returned a non-array");
	const table = new Map<string, number>();
	for (const entry of body) {
		if (typeof entry !== "object" || entry === null) continue;
		const { name, unitCostMicroUSD, unitLabel } = entry as Record<string, unknown>;
		if (
			typeof name === "string" &&
			typeof unitCostMicroUSD === "number" &&
			Number.isFinite(unitCostMicroUSD) &&
			unitCostMicroUSD >= 0 &&
			unitLabel === "minute"
		) {
			table.set(name, Math.round(unitCostMicroUSD));
		}
	}
	if (table.size === 0) throw new Error("hardware API returned no priced flavors");
	livePrices = table;
	lastFetchAt = Date.now();
}

/**
 * Per-minute price for a flavor, or undefined for one the gate must refuse.
 * Serves the cached live list, refreshing after the TTL; a failed refresh keeps
 * serving the last good list (prices move rarely and staleness only mis-sizes
 * the refund, never the guarantee).
 */
export async function getFlavorPriceMicroUsdPerMinute(flavor: string): Promise<number | undefined> {
	if (!livePrices || Date.now() - lastFetchAt > PRICE_CACHE_TTL_MS) {
		inflight ??= refreshLivePrices().finally(() => {
			inflight = undefined;
		});
		try {
			await inflight;
		} catch (err) {
			// Serve stale below; only warn on the transition to degraded.
			if (!livePrices) {
				logger.warn({ err: String(err) }, "[mlBudget] hardware price fetch failed; using snapshot");
			}
			lastFetchAt = Date.now();
		}
	}
	return livePrices?.get(flavor) ?? FALLBACK_PRICES_MICRO_USD_PER_MINUTE[flavor];
}

export function resetPriceCacheForTests(): void {
	livePrices = undefined;
	lastFetchAt = 0;
	inflight = undefined;
}

const TIMEOUT_PATTERN = /^\s*(\d+(?:\.\d+)?)\s*([smhd]?)\s*$/;
const TIMEOUT_UNIT_SECONDS: Record<string, number> = { "": 1, s: 1, m: 60, h: 3600, d: 86_400 };

/**
 * Timeout as the jobs API accepts it: a bare number is seconds, otherwise a
 * number with an s/m/h/d suffix ("45m", "1.5h"). Undefined for anything else,
 * including zero and negatives — the gate refuses what it cannot bound.
 */
export function parseTimeoutSeconds(value: unknown): number | undefined {
	let match: RegExpExecArray | null = null;
	if (typeof value === "number") {
		if (!Number.isFinite(value) || value <= 0) return undefined;
		return Math.ceil(value);
	}
	if (typeof value === "string") {
		match = TIMEOUT_PATTERN.exec(value);
	}
	if (!match) return undefined;
	const seconds = Number(match[1]) * TIMEOUT_UNIT_SECONDS[match[2]];
	if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
	return Math.ceil(seconds);
}

/** Billing is per started minute, so the ceiling rounds the timeout up. */
export function ceilingMicroUsd(priceMicroUsdPerMinute: number, timeoutSeconds: number): number {
	return priceMicroUsdPerMinute * Math.ceil(timeoutSeconds / 60);
}
