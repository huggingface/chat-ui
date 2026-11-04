import { describe, expect, it } from "vitest";
import { dedupeModelsById } from "./models";

describe("dedupeModelsById", () => {
	it("keeps the first model for each id and preserves order", () => {
		const first = { id: "azure/gpt-4", displayName: "first" };
		const duplicate = { id: "azure/gpt-4", displayName: "duplicate" };
		const other = { id: "azure/gpt-4o", displayName: "other" };

		expect(dedupeModelsById([first, duplicate, other])).toEqual([first, other]);
	});
});
