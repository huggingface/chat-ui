import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { MlBudget } from "$lib/types/Conversation";
import { formatMicroUsd, remainingMicroUsd } from "$lib/utils/mlBudget";

/**
 * The session-context line states the budget once, when the turn starts. The
 * user can change the total from the strip while the turn runs, and nothing
 * else would tell the model: it would go on asking for a grant it already has.
 * Only the total is watched — spend and holds move with the model's own
 * submissions, which it already hears about through their tool results.
 */
export function budgetChangeNote(seenTotalMicroUsd: number, budget: MlBudget | undefined) {
	const effective = budget ?? { totalMicroUsd: 0, spentMicroUsd: 0, reservations: [] };
	if (effective.totalMicroUsd === seenTotalMicroUsd) return undefined;
	return `The user changed the session compute budget during this turn: it is now ${formatMicroUsd(
		remainingMicroUsd(effective)
	)} remaining of ${formatMicroUsd(effective.totalMicroUsd)}. This supersedes the Budget in the session context line.`;
}

/**
 * Appends the note to the round's last tool result rather than adding a message
 * of its own: a system or user message wedged between tool results and the next
 * completion is rejected or misread by some providers.
 */
export function appendToLastToolMessage(
	messages: ChatCompletionMessageParam[],
	note: string
): ChatCompletionMessageParam[] {
	const index = messages.findLastIndex((m) => m.role === "tool");
	if (index === -1) return messages;
	const last = messages[index];
	if (last.role !== "tool") return messages;
	const content =
		typeof last.content === "string"
			? `${last.content}\n\n${note}`
			: [...last.content, { type: "text" as const, text: `\n\n${note}` }];
	return messages.map((m, i) => (i === index ? { ...last, content } : m));
}
