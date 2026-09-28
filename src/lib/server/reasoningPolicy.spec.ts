import { describe, expect, it } from "vitest";
import { preservesReasoningByDefault } from "./reasoningPolicy";

describe("preservesReasoningByDefault", () => {
	it("defaults on for models nobody has said anything about", () => {
		// The point of the flip: a reasoning model added to the router works
		// without anyone remembering to configure it. Under the previous opt-in
		// flag these all silently lost preservation.
		for (const id of [
			"moonshotai/Kimi-K3",
			"deepseek-ai/DeepSeek-V4-Flash",
			"zai-org/GLM-5.2",
			"some-org/a-model-released-tomorrow",
		]) {
			expect(preservesReasoningByDefault(id), id).toBe(true);
		}
	});

	it("blocks the gemma family, whose provider rejects the field outright", () => {
		for (const id of [
			"google/gemma-4-31B-it",
			"google/gemma-3-27b-it",
			"google/gemma-3n-E4B-it",
			"google/gemma-4-26B-A4B-it",
		]) {
			expect(preservesReasoningByDefault(id), id).toBe(false);
		}
	});

	it("blocks community re-releases of a blocked family", () => {
		// Same chat template, same constraint, different publisher — matching on
		// the org alone would miss these.
		expect(preservesReasoningByDefault("pearl-ai/Gemma-4-31B-it-pearl")).toBe(false);
		expect(preservesReasoningByDefault("aisingapore/Gemma-SEA-LION-v4-27B-IT")).toBe(false);
	});

	it("treats a missing id as unblocked rather than throwing", () => {
		expect(preservesReasoningByDefault(undefined)).toBe(true);
		expect(preservesReasoningByDefault("")).toBe(true);
	});
});
