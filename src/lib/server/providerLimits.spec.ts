import { describe, expect, it } from "vitest";
import { providerMaxTokensCap } from "./providerLimits";

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
