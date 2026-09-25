import { error, type RequestHandler } from "@sveltejs/kit";
import { superjsonResponse } from "$lib/server/api/utils/superjsonResponse";
import { requireAuth } from "$lib/server/api/utils/requireAuth";
import { resolveConversation } from "$lib/server/api/utils/resolveConversation";
import { collections } from "$lib/server/database";
import { deleteMlFilesOf } from "$lib/server/mlFiles/store";
import { deleteMlRegistry } from "$lib/server/mlRegistry/store";
import { authCondition } from "$lib/server/auth";
import { ObjectId } from "mongodb";
import { validModelIdSchema } from "$lib/server/models";
import { applyConversationSettings } from "$lib/server/conversationSettings";
import { setMlBudgetLeft, setMlBudgetTotal } from "$lib/server/mlBudget/budget";
import { reservedMicroUsd, usdToMicroUsd } from "$lib/utils/mlBudget";
import type { TurnStateSnapshot } from "$lib/types/TurnState";
import { toLegacyShape } from "$lib/utils/messageShape";

export const GET: RequestHandler = async ({ locals, params, url }) => {
	requireAuth(locals);

	const conversation = await resolveConversation(
		params.id ?? "",
		locals,
		url.searchParams.get("fromShare")
	);

	// The last assistant message's authoritative liveness, alongside the
	// snapshot it describes. `serverNow` lets the client correct clock skew so
	// a waiting turn's countdown renders true remaining time on load.
	const lastAssistant = [...conversation.messages]
		.reverse()
		.find((message) => message.from === "assistant");
	// Share views resolve with a string id; ObjectId accepts both forms.
	const turnStateDoc = lastAssistant
		? await collections.turnStates
				.findOne({ conversationId: new ObjectId(conversation._id), messageId: lastAssistant.id })
				.catch(() => null)
		: null;
	const turnState: TurnStateSnapshot | undefined = turnStateDoc
		? {
				messageId: turnStateDoc.messageId,
				status: turnStateDoc.status,
				serverNow: Date.now(),
				...(turnStateDoc.waitUntil ? { until: turnStateDoc.waitUntil.getTime() } : {}),
				...(turnStateDoc.waitReason ? { reason: turnStateDoc.waitReason } : {}),
				...(turnStateDoc.error ? { error: turnStateDoc.error } : {}),
			}
		: undefined;

	return superjsonResponse({
		messages: conversation.messages.map(toLegacyShape),
		title: conversation.title,
		model: conversation.model,
		preprompt: conversation.preprompt,
		rootMessageId: conversation.rootMessageId,
		id: conversation._id.toString(),
		updatedAt: conversation.updatedAt,
		modelId: conversation.model,
		shared: conversation.shared,
		deployedSpaces: "deployedSpaces" in conversation ? conversation.deployedSpaces : undefined,
		mlAssistant: "mlAssistant" in conversation ? conversation.mlAssistant : undefined,
		mlBudget: "mlBudget" in conversation ? conversation.mlBudget : undefined,
		plan: "plan" in conversation ? conversation.plan : undefined,
		turnState,
	});
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	requireAuth(locals);

	const id = params.id ?? "";
	if (!ObjectId.isValid(id)) {
		error(400, "Invalid conversation ID");
	}
	const res = await collections.conversations.deleteOne({
		_id: new ObjectId(id),
		...authCondition(locals),
	});

	if (res.deletedCount === 0) {
		error(404, "Conversation not found");
	}
	await deleteMlFilesOf([new ObjectId(id)]);
	await deleteMlRegistry([new ObjectId(id)]);

	return superjsonResponse({ success: true });
};

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	requireAuth(locals);

	const body = await request.json();
	const title = body?.title as string | undefined;
	const model = body?.model as string | undefined;
	const mlBudgetTotalUsd = body?.mlBudgetTotalUsd as number | undefined;
	const mlBudgetLeftUsd = body?.mlBudgetLeftUsd as number | undefined;

	if (title !== undefined) {
		if (typeof title !== "string" || title.length === 0 || title.length > 100) {
			error(400, "Title must be a string between 1 and 100 characters");
		}
	}

	if (model !== undefined) {
		if (!validModelIdSchema.safeParse(model).success) {
			error(400, "Invalid model ID");
		}
	}

	if (mlBudgetTotalUsd !== undefined) {
		if (
			typeof mlBudgetTotalUsd !== "number" ||
			!Number.isFinite(mlBudgetTotalUsd) ||
			mlBudgetTotalUsd < 0 ||
			mlBudgetTotalUsd > 10_000
		) {
			// Zero is allowed: it pauses spend on the conversation while keeping the
			// ledger's spend and open holds intact.
			error(400, "Budget must be a number of dollars between 0 and 10000");
		}
	}

	if (mlBudgetLeftUsd !== undefined) {
		if (mlBudgetTotalUsd !== undefined) {
			error(400, "Set either the budget total or what is left, not both");
		}
		if (
			typeof mlBudgetLeftUsd !== "number" ||
			!Number.isFinite(mlBudgetLeftUsd) ||
			mlBudgetLeftUsd < 0 ||
			mlBudgetLeftUsd > 10_000
		) {
			error(400, "Budget must be a number of dollars between 0 and 10000");
		}
	}

	const id = params.id ?? "";
	if (!ObjectId.isValid(id)) {
		error(400, "Invalid conversation ID");
	}

	if (mlBudgetLeftUsd !== undefined) {
		// The server owns the arithmetic: left + spent + held is summed against the
		// live ledger in the write itself, so the client's snapshot never skews it.
		const result = await setMlBudgetLeft({
			conversationId: new ObjectId(id),
			leftMicroUsd: usdToMicroUsd(mlBudgetLeftUsd),
			maxTotalMicroUsd: usdToMicroUsd(10_000),
			extraFilter: { ...authCondition(locals), mlAssistant: true },
		});
		if (result.outcome === "not_found") {
			error(404, "Conversation not found");
		}
		if (result.outcome === "over_ceiling") {
			error(400, "Budget total cannot exceed 10000 dollars");
		}
		const { budget } = result;
		const mlBudget = {
			totalMicroUsd: budget.totalMicroUsd,
			spentMicroUsd: budget.spentMicroUsd,
			reservedMicroUsd: reservedMicroUsd(budget),
		};
		if (title === undefined && model === undefined) {
			return superjsonResponse({ success: true, mlBudget });
		}
	}

	if (mlBudgetTotalUsd !== undefined) {
		// Guarded on mlAssistant so a budget cannot be conjured onto an ordinary
		// conversation; spend and open holds survive the change untouched.
		const matched = await setMlBudgetTotal({
			conversationId: new ObjectId(id),
			totalMicroUsd: usdToMicroUsd(mlBudgetTotalUsd),
			extraFilter: { ...authCondition(locals), mlAssistant: true },
		});
		if (!matched) {
			error(404, "Conversation not found");
		}
		if (title === undefined && model === undefined) {
			return superjsonResponse({ success: true });
		}
	}
	// Shared with the legacy handler: a plain $set here would change the pinned
	// model without recording who produced the existing turns, and the next
	// request would replay one model's reasoning onto another.
	const res = await applyConversationSettings(
		{ _id: new ObjectId(id), ...authCondition(locals) },
		{ title, model }
	);

	if (typeof res.matchedCount === "number" ? res.matchedCount === 0 : res.modifiedCount === 0) {
		error(404, "Conversation not found");
	}

	return superjsonResponse({ success: true });
};
