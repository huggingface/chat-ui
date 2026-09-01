import {
	ASK_USER_QUESTION_TOOL_NAME,
	askUserQuestionTool,
	openAskPrompt,
} from "$lib/server/askUserQuestion";
import { turnAwaitingInput } from "$lib/server/generation/turnState";
import type { BuiltinTool } from "./types";

export const askUserQuestionBuiltin: BuiltinTool = {
	name: ASK_USER_QUESTION_TOOL_NAME,
	definition: askUserQuestionTool,
	exemptFromToolRestraint: true,
	preprompt:
		`ASKING THE USER: When the request has more than one sensible reading and those readings lead to materially different work, call ${ASK_USER_QUESTION_TOOL_NAME} before starting rather than guessing. ` +
		`Asking in prose instead does not count — a question in your reply cannot be answered with a click, and the user may not be there to read it. ` +
		`Tool calls happen only through the function-calling mechanism — writing <${ASK_USER_QUESTION_TOOL_NAME}> tags into reply text calls nothing and shows the user broken markup. ` +
		`Give 2-4 concrete options, each with a short note on what picking it means, and set multiSelect when more than one can apply together. ` +
		`Ask once, then get on with the work using what you are told. ` +
		`Do not use it for something you can look up, for a choice with an obvious default, or when the user has already said what they want.`,
	mayPark: true,
	// One call carries several questions, so say that instead of asking twice.
	parkRefusalMessage:
		"Only one ask_user_question call can be answered per turn. " +
		"Put every question in a single call's `questions` array.",
	async execute(args, ctx) {
		const opened = ctx.elicitationSink
			? await openAskPrompt({
					sink: ctx.elicitationSink,
					toolUuid: ctx.uuid,
					toolCallId: ctx.toolCallId,
					messageId: ctx.messageId ?? "",
					args,
				})
			: { opened: false as const, reason: "no chat to ask" };

		if (opened.opened) {
			// A shown question is a lifecycle transition: the turn is parked on the
			// user. Recorded on the turn state and sent in-band like every other
			// transition (see turnState.ts).
			if (ctx.conversationId && ctx.messageId) {
				const stateUpdate = await turnAwaitingInput({
					conversationId: ctx.conversationId,
					messageId: ctx.messageId,
					producerId: ctx.generationId ?? "",
					...(ctx.userId ? { userId: ctx.userId } : {}),
					...(ctx.sessionId ? { sessionId: ctx.sessionId } : {}),
				});
				ctx.elicitationSink?.emit(stateUpdate);
			}
			return { awaitingInput: true };
		}
		// Answering is the only way this call finishes, so a silent skip would hang it.
		return { error: `The question could not be shown (${opened.reason}).` };
	},
};
