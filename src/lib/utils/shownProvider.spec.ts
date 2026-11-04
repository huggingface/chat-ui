import { describe, expect, it } from "vitest";
import { shownProvider } from "./shownProvider";

const model = { id: "deepseek-ai/DeepSeek-V4.1-Flash-1017", defaultProvider: "novita" };

describe("shownProvider", () => {
	it("shows the default when nothing is saved", () => {
		expect(shownProvider(model, {})).toBe("novita");
		expect(shownProvider(model, undefined)).toBe("novita");
	});

	it("shows the user's pick over the default", () => {
		expect(shownProvider(model, { [model.id]: "baseten" })).toBe("baseten");
		expect(shownProvider(model, { [model.id]: "fastest" })).toBe("fastest");
	});

	it("shows nothing for a saved auto, even with a default", () => {
		expect(shownProvider(model, { [model.id]: "auto" })).toBeUndefined();
	});

	it("shows nothing for a model without a default or a pick, or for Omni", () => {
		expect(shownProvider({ id: "m" }, {})).toBeUndefined();
		expect(shownProvider({ ...model, isRouter: true }, { [model.id]: "baseten" })).toBeUndefined();
	});
});
