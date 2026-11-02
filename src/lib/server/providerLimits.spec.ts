import { describe, expect, it } from "vitest";
import { capMaxTokens, providerMaxTokensCap } from "./providerLimits";

const model = { providerMaxTokens: { scaleway: 32768, together: 40000 } };

describe("providerMaxTokensCap", () => {
	it("uses a named provider's own cap", () => {
		expect(providerMaxTokensCap(model, "scaleway")).toBe(32768);
		expect(providerMaxTokensCap(model, "novita")).toBeUndefined();
	});

	it("uses the lowest cap when the router picks the provider", () => {
		expect(providerMaxTokensCap(model, undefined)).toBe(32768);
		expect(providerMaxTokensCap(model, "auto")).toBe(32768);
		expect(providerMaxTokensCap(model, "fastest")).toBe(32768);
	});

	it("has no cap for a model without any", () => {
		expect(providerMaxTokensCap({}, undefined)).toBeUndefined();
	});
});

describe("capMaxTokens", () => {
	it("keeps the model's own limit on a provider without a cap", () => {
		expect(capMaxTokens(model, "novita", 49152)).toBe(49152);
	});

	it("lowers the limit to the cap", () => {
		expect(capMaxTokens(model, "scaleway", 49152)).toBe(32768);
		expect(capMaxTokens(model, undefined, 49152)).toBe(32768);
	});

	it("never raises a limit below the cap", () => {
		expect(capMaxTokens(model, "scaleway", 8192)).toBe(8192);
	});

	it("leaves an unset limit unset", () => {
		expect(capMaxTokens(model, "scaleway", undefined)).toBeUndefined();
	});
});
