import type { CreateIndexesOptions, IndexSpecification } from "mongodb";

/** the review twin of the partial ask indexes, shared with the spec that checks they coexist */
export const ML_REVIEW_ELICITATION_INDEXES: {
	keys: IndexSpecification;
	options: CreateIndexesOptions & { name: string };
}[] = [
	{
		keys: { status: 1, resolvedAt: 1 },
		options: {
			name: "status_1_resolvedAt_1_review",
			partialFilterExpression: { "pending.kind": "review" },
		},
	},
	{
		keys: { conversationId: 1, status: 1 },
		options: {
			name: "conversationId_1_status_1_review",
			partialFilterExpression: { "pending.kind": "review" },
		},
	},
];
