import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { collections, ready } from "$lib/server/database";
import { ASK_ELICITATION_INDEXES } from "$lib/server/mcp/elicitationIndexes";
import { ML_REVIEW_ELICITATION_INDEXES } from "./indexes";

await ready;
// built here, a test database can stop mid build and initDatabase only logs a collision
await Promise.all(
	[...ASK_ELICITATION_INDEXES, ...ML_REVIEW_ELICITATION_INDEXES].map((index) =>
		collections.mcpElicitations.createIndex(index.keys, index.options)
	)
);

const REVIEW_NAMES = ML_REVIEW_ELICITATION_INDEXES.map((index) => index.options.name);

const indexNames = (plan: unknown): string[] =>
	[...JSON.stringify(plan).matchAll(/"indexName":"([^"]+)"/g)].map((match) => match[1]);

describe("review elicitation indexes", () => {
	it("exist next to the ask pair, on the same keys, under their own names", async () => {
		const indexes = await collections.mcpElicitations.indexes();
		const partial = (kind: string) =>
			indexes
				.filter((index) => index.partialFilterExpression?.["pending.kind"] === kind)
				.map((index) => [index.name, index.key])
				.sort(([a], [b]) => String(a).localeCompare(String(b)));
		expect(partial("ask")).toEqual([
			["conversationId_1_status_1", { conversationId: 1, status: 1 }],
			["status_1_resolvedAt_1", { status: 1, resolvedAt: 1 }],
		]);
		expect(partial("review")).toEqual([
			["conversationId_1_status_1_review", { conversationId: 1, status: 1 }],
			["status_1_resolvedAt_1_review", { status: 1, resolvedAt: 1 }],
		]);
	});

	it("would collide with the ask pair under generated names", async () => {
		const [review] = ML_REVIEW_ELICITATION_INDEXES;
		const options = { partialFilterExpression: review.options.partialFilterExpression };
		await expect(
			collections.mcpElicitations.createIndex(review.keys, options)
		).rejects.toMatchObject({ codeName: "IndexKeySpecsConflict" });
	});

	it("serve the per-kind sweep and settle queries", async () => {
		const sweep = await collections.mcpElicitations
			.find({
				status: "resolved",
				"pending.kind": "review",
				resolution: "user",
				resolvedAt: { $gte: new Date(0) },
			})
			.explain();
		expect(indexNames(sweep.queryPlanner.winningPlan)).toEqual(["status_1_resolvedAt_1_review"]);

		const settle = await collections.mcpElicitations
			.find({ conversationId: new ObjectId(), status: "resolved", "pending.kind": "review" })
			.explain();
		const used = indexNames(settle.queryPlanner.winningPlan);
		expect(used).toHaveLength(1);
		expect(REVIEW_NAMES).toContain(used[0]);
	});
});
