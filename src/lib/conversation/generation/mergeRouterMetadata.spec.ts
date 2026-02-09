import { describe, expect, it } from "vitest";
import { mergeRouterMetadata } from "./mergeRouterMetadata";

describe("mergeRouterMetadata", () => {
	it("applies route/model updates and keeps previous provider when omitted", () => {
		const merged = mergeRouterMetadata(
			{
				route: "old-route",
				model: "old-model",
				provider: "hf-inference" as never,
			},
			{ route: "new-route", model: "new-model" }
		);

		expect(merged).toEqual({
			route: "new-route",
			model: "new-model",
			provider: "hf-inference",
		});
	});

	it("keeps existing route/model on provider-only updates", () => {
		const merged = mergeRouterMetadata(
			{ route: "router-a", model: "model-a" },
			{ route: "", model: "", provider: "cerebras" as never }
		);

		expect(merged).toEqual({ route: "router-a", model: "model-a", provider: "cerebras" });
	});

	it("does not erase existing values when incoming fields are empty", () => {
		const merged = mergeRouterMetadata(
			{ route: "router-a", model: "model-a", provider: "hf-inference" as never },
			{ route: "   ", model: "", provider: undefined }
		);

		expect(merged).toEqual({
			route: "router-a",
			model: "model-a",
			provider: "hf-inference",
		});
	});

	it("supports undefined incoming metadata and empty existing state", () => {
		expect(mergeRouterMetadata(undefined, undefined)).toEqual({ route: "", model: "" });
		expect(
			mergeRouterMetadata(
				{ route: "router-a", model: "model-a", provider: "hf-inference" as never },
				undefined
			)
		).toEqual({
			route: "router-a",
			model: "model-a",
			provider: "hf-inference",
		});
		expect(
			mergeRouterMetadata(undefined, { route: "", model: "", provider: "novita" as never })
		).toEqual({ route: "", model: "", provider: "novita" });
	});
});
