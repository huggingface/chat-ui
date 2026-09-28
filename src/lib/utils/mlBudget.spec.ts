import { describe, expect, it } from "vitest";
import { formatMicroUsdCompact } from "./mlBudget";

describe("formatMicroUsdCompact", () => {
	it("rounds up to whole dollars for the collapsed strip", () => {
		expect(formatMicroUsdCompact(880_000)).toBe("$1");
		expect(formatMicroUsdCompact(2_140_000)).toBe("$3");
		expect(formatMicroUsdCompact(4_000_000)).toBe("$4");
	});

	it("does not read as spent while a fraction is left", () => {
		// The whole reason for the ceiling: "$0" says the run cannot continue.
		expect(formatMicroUsdCompact(10_000)).toBe("$1");
		expect(formatMicroUsdCompact(0)).toBe("$0");
	});

	it("keeps the sign on an overspend", () => {
		expect(formatMicroUsdCompact(-2_100_000)).toBe("-$3");
	});
});
