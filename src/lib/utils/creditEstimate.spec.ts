import { describe, expect, it } from "vitest";
import { estimateTokens, formatTokenCount, type ProviderPricing } from "./creditEstimate";

const providers: ProviderPricing[] = [
	// blended usd per 1M tokens at 5 input to 1 output, 1.5, 3, 6
	{ provider: "cheap", status: "live", pricing: { input: 1.2, output: 3 } },
	{ provider: "mid", status: "live", pricing: { input: 2.4, output: 6 } },
	{ provider: "pricey", status: "live", pricing: { input: 4.8, output: 12 } },
];

describe("estimateTokens", () => {
	it("prices at the provider the user picked", () => {
		expect(estimateTokens(providers, { providerOverride: "pricey" })).toBeCloseTo(2 / 6e-6);
	});

	it("falls back to the model's default provider when nothing is picked", () => {
		expect(estimateTokens(providers, { defaultProvider: "cheap" })).toBeCloseTo(2 / 1.5e-6);
	});

	it("takes the cheapest price for the cheapest policy", () => {
		expect(
			estimateTokens(providers, { providerOverride: "cheapest", defaultProvider: "pricey" })
		).toBeCloseTo(2 / 1.5e-6);
	});

	it("takes the median when the router picks", () => {
		for (const providerOverride of ["auto", "fastest", "preferred"]) {
			expect(
				estimateTokens(providers, { providerOverride, defaultProvider: "pricey" })
			).toBeCloseTo(2 / 3e-6);
		}
		expect(estimateTokens(providers, {})).toBeCloseTo(2 / 3e-6);
	});

	it("treats a pick without a price like no pick", () => {
		expect(
			estimateTokens(providers, { providerOverride: "gone", defaultProvider: "cheap" })
		).toBeCloseTo(2 / 1.5e-6);
	});

	it("scales with the credit amount", () => {
		expect(estimateTokens(providers, { providerOverride: "mid" }, 10)).toBeCloseTo(10 / 3e-6);
	});

	it("ignores providers that are not live or have no usable price", () => {
		const listed: ProviderPricing[] = [
			{ provider: "down", status: "error", pricing: { input: 0.01, output: 0.01 } },
			{ provider: "unpriced", status: "live" },
			{ provider: "free", status: "live", pricing: { input: 0, output: 0 } },
			{ provider: "broken", status: "live", pricing: { input: "1", output: 2 } },
			{ provider: "mid", status: "live", pricing: { input: 2.4, output: 6 } },
		];
		expect(estimateTokens(listed, {})).toBeCloseTo(2 / 3e-6);
		expect(estimateTokens(listed.slice(0, 4), {})).toBeUndefined();
		expect(estimateTokens(undefined, {})).toBeUndefined();
	});
});

describe("formatTokenCount", () => {
	it("rounds down to two significant digits", () => {
		expect(formatTokenCount(1_318_681)).toBe("1.3M");
		expect(formatTokenCount(421_052)).toBe("420k");
		expect(formatTokenCount(41_379_310)).toBe("41M");
		expect(formatTokenCount(80_000_000)).toBe("80M");
		expect(formatTokenCount(5_333_333)).toBe("5.3M");
		expect(formatTokenCount(2_590_000_000)).toBe("2.5B");
		expect(formatTokenCount(999)).toBe("990");
		expect(formatTokenCount(7)).toBe("7");
	});
});
