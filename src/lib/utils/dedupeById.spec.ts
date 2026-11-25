import { describe, expect, it } from "vitest";
import { dedupeById, droppedDuplicateIds } from "./dedupeById";

describe("dedupeById", () => {
	it("keeps the first model when an upstream list repeats an id", () => {
		const models = [
			{ id: "gpt-4o", name: "first" },
			{ id: "gpt-4o-mini", name: "mini" },
			{ id: "gpt-4o", name: "again" },
		];
		expect(dedupeById(models)).toEqual([
			{ id: "gpt-4o", name: "first" },
			{ id: "gpt-4o-mini", name: "mini" },
		]);
		expect(droppedDuplicateIds(models)).toEqual(["gpt-4o"]);
	});

	it("leaves a list of unique ids unchanged", () => {
		const models = [
			{ id: "a", name: "a" },
			{ id: "b", name: "b" },
		];
		expect(dedupeById(models)).toEqual(models);
	});
});
