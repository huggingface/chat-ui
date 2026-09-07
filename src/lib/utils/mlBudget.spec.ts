import { describe, expect, it } from "vitest";
import { formatMicroUsd, formatMicroUsdCompact } from "./mlBudget";

describe("formatMicroUsdCompact", () => {
	it("drops to whole dollars for the mobile strip", () => {
		expect(formatMicroUsdCompact(4_250_000)).toBe("$4");
		expect(formatMicroUsdCompact(10_000_000)).toBe("$10");
	});

	it("rounds down, so it never claims more than is left", () => {
		expect(formatMicroUsdCompact(4_990_000)).toBe("$4");
	});

	it("keeps cents under a dollar, where the difference decides a run", () => {
		expect(formatMicroUsdCompact(340_000)).toBe("$0.34");
		expect(formatMicroUsdCompact(0)).toBe("$0.00");
	});

	it("keeps the sign on an overspend", () => {
		expect(formatMicroUsdCompact(-2_500_000)).toBe("-$2");
	});

	it("agrees with the full form wherever it does not abbreviate", () => {
		expect(formatMicroUsdCompact(999_999)).toBe(formatMicroUsd(999_999));
	});
});
