import { describe, expect, it } from "vitest";

import { uniqueModelsById } from "./models";

describe("uniqueModelsById", () => {
	it("keeps the first model when a provider returns duplicate IDs", () => {
		expect(
			uniqueModelsById([
				{ id: "azure-gpt", name: "first" },
				{ id: "azure-gpt", name: "duplicate" },
				{ id: "other", name: "other" },
			])
		).toEqual([
			{ id: "azure-gpt", name: "first" },
			{ id: "other", name: "other" },
		]);
	});
});
