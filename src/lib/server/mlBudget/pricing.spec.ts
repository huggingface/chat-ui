import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
	ceilingMicroUsd,
	getFlavorPriceMicroUsdPerMinute,
	parseTimeoutSeconds,
	resetPriceCacheForTests,
} from "./pricing";

describe("parseTimeoutSeconds", () => {
	it("accepts the forms the jobs API accepts", () => {
		expect(parseTimeoutSeconds(1800)).toBe(1800);
		expect(parseTimeoutSeconds("300")).toBe(300);
		expect(parseTimeoutSeconds("3600s")).toBe(3600);
		expect(parseTimeoutSeconds("45m")).toBe(2700);
		expect(parseTimeoutSeconds("2h")).toBe(7200);
		expect(parseTimeoutSeconds("1.5h")).toBe(5400);
		expect(parseTimeoutSeconds("1d")).toBe(86_400);
		expect(parseTimeoutSeconds(" 30m ")).toBe(1800);
	});

	it("rounds fractional seconds up, never down", () => {
		expect(parseTimeoutSeconds(90.2)).toBe(91);
		expect(parseTimeoutSeconds("0.5s")).toBe(1);
	});

	it("refuses what it cannot bound", () => {
		expect(parseTimeoutSeconds(0)).toBeUndefined();
		expect(parseTimeoutSeconds(-5)).toBeUndefined();
		expect(parseTimeoutSeconds("")).toBeUndefined();
		expect(parseTimeoutSeconds("abc")).toBeUndefined();
		expect(parseTimeoutSeconds("2w")).toBeUndefined();
		expect(parseTimeoutSeconds("-2h")).toBeUndefined();
		expect(parseTimeoutSeconds(null)).toBeUndefined();
		expect(parseTimeoutSeconds(undefined)).toBeUndefined();
		expect(parseTimeoutSeconds(Infinity)).toBeUndefined();
	});
});

describe("ceilingMicroUsd", () => {
	it("bills per started minute", () => {
		expect(ceilingMicroUsd(25_000, 3600)).toBe(25_000 * 60);
		expect(ceilingMicroUsd(167, 61)).toBe(167 * 2);
		expect(ceilingMicroUsd(167, 60)).toBe(167);
		expect(ceilingMicroUsd(167, 1)).toBe(167);
	});
});

describe("getFlavorPriceMicroUsdPerMinute", () => {
	beforeEach(() => resetPriceCacheForTests());
	afterEach(() => vi.unstubAllGlobals());

	it("serves the live list when the hardware API answers", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ({
				ok: true,
				json: async () => [
					{ name: "t4-small", unitCostMicroUSD: 9999, unitLabel: "minute" },
					// Priced per hour would break the arithmetic: must be ignored.
					{ name: "weird-flavor", unitCostMicroUSD: 1, unitLabel: "hour" },
				],
			}))
		);
		expect(await getFlavorPriceMicroUsdPerMinute("t4-small")).toBe(9999);
		expect(await getFlavorPriceMicroUsdPerMinute("weird-flavor")).toBeUndefined();
	});

	it("fetches once within the TTL", async () => {
		const fetchMock = vi.fn(async () => ({
			ok: true,
			json: async () => [{ name: "t4-small", unitCostMicroUSD: 9999, unitLabel: "minute" }],
		}));
		vi.stubGlobal("fetch", fetchMock);
		await getFlavorPriceMicroUsdPerMinute("t4-small");
		await getFlavorPriceMicroUsdPerMinute("t4-small");
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("falls back to the snapshot when the API is unreachable", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new Error("network down");
			})
		);
		expect(await getFlavorPriceMicroUsdPerMinute("t4-small")).toBe(6667);
		expect(await getFlavorPriceMicroUsdPerMinute("cpu-basic")).toBe(167);
	});

	it("fails closed on a flavor nobody prices", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new Error("network down");
			})
		);
		expect(await getFlavorPriceMicroUsdPerMinute("quantum-x9000")).toBeUndefined();
	});
});
