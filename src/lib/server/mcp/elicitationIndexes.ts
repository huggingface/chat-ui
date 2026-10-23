import type { CreateIndexesOptions, IndexSpecification } from "mongodb";

/**
 * Answered questions: the sweep for ones nothing continued, and the per-conversation lookup
 * the message route makes before every ML turn. Partial, because rows with a parked call never
 * expire and only the model's own questions are ever looked up.
 */
export const ASK_ELICITATION_INDEXES: {
	keys: IndexSpecification;
	options: CreateIndexesOptions;
	label: string;
}[] = [
	{
		keys: { status: 1, resolvedAt: 1 },
		options: { partialFilterExpression: { "pending.kind": "ask" } },
		label: "resolvedAt",
	},
	{
		keys: { conversationId: 1, status: 1 },
		options: { partialFilterExpression: { "pending.kind": "ask" } },
		label: "conversationId",
	},
];
