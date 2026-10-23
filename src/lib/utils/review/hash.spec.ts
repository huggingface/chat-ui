import { describe, expect, it } from "vitest";
import type { ReviewSchema } from "$lib/types/MlReview";
import { reviewSchemaHash } from "./hash";

const schema: Pick<ReviewSchema, "fields" | "questions"> = {
	fields: [{ name: "body", type: "text", title: "Body" }],
	questions: [
		{ name: "kind", type: "label", required: true, options: [{ value: "a" }, { value: "b" }] },
	],
};

describe("reviewSchemaHash", () => {
	it("is 8 hex characters and stable under key order", async () => {
		const hash = await reviewSchemaHash(schema);
		expect(hash).toMatch(/^[0-9a-f]{8}$/);
		const reordered = {
			questions: [
				{ options: [{ value: "a" }, { value: "b" }], required: true, type: "label", name: "kind" },
			],
			fields: [{ title: "Body", type: "text", name: "body" }],
		} as unknown as typeof schema;
		expect(await reviewSchemaHash(reordered)).toBe(hash);
	});

	it("changes when the schema changes, including option order", async () => {
		const hash = await reviewSchemaHash(schema);
		const swapped = {
			...schema,
			questions: [{ ...schema.questions[0], options: [{ value: "b" }, { value: "a" }] }],
		} as typeof schema;
		expect(await reviewSchemaHash(swapped)).not.toBe(hash);
		expect(
			await reviewSchemaHash({ ...schema, fields: [{ name: "body", type: "markdown" }] })
		).not.toBe(hash);
	});
});
