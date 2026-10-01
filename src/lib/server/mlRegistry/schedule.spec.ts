import { describe, it, expect } from "vitest";
import type { MlServiceKind } from "$lib/types/MlService";
import { backoffDelayMs, nextPollDelayMs } from "./schedule";

const now = new Date("2026-09-25T12:00:00Z");
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
const service = (kind: MlServiceKind, stage: string, startedAt?: Date) => ({
	kind,
	stage,
	...(startedAt ? { startedAt } : {}),
});

describe("nextPollDelayMs", () => {
	it.each([
		["a queued job", service("job", "SCHEDULING"), 15_000],
		["a queued job whose start is stale", service("job", "SCHEDULING", minutesAgo(20)), 15_000],
		["a job not yet classified", service("job", "UNKNOWN"), 15_000],
		["a job in its first ten minutes of running", service("job", "RUNNING", minutesAgo(9)), 5_000],
		["a job running for ten minutes", service("job", "RUNNING", minutesAgo(10)), 15_000],
		["a job running for 29 minutes", service("job", "RUNNING", minutesAgo(29)), 15_000],
		["a job running for 30 minutes", service("job", "RUNNING", minutesAgo(30)), 60_000],
		["a job running for hours", service("job", "RUNNING", minutesAgo(180)), 60_000],
		["a running job with no known start", service("job", "RUNNING"), 5_000],
		["a queued sandbox", service("sandbox", "SCHEDULING"), 15_000],
		["a running sandbox", service("sandbox", "RUNNING", minutesAgo(1)), 30_000],
		["a sandbox running for hours", service("sandbox", "RUNNING", minutesAgo(180)), 30_000],
	])("%s", (_, row, expected) => {
		expect(nextPollDelayMs(row, now)).toBe(expected);
	});
});

describe("backoffDelayMs", () => {
	it("retries the first failure on the normal cadence, then doubles up to five minutes", () => {
		expect([1, 2, 3, 4, 5, 6, 7, 8].map((failures) => backoffDelayMs(5_000, failures))).toEqual([
			5_000, 10_000, 20_000, 40_000, 80_000, 160_000, 300_000, 300_000,
		]);
		expect(backoffDelayMs(60_000, 3)).toBe(240_000);
		expect(backoffDelayMs(60_000, 4)).toBe(300_000);
	});
});
