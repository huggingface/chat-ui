import { runWebSearch } from "$lib/server/websearch/runWebSearch";
import { preprocessMessages } from "../endpoints/preprocessMessages";

import { generateTitleForConversation } from "./title";
import {
	assistantHasDynamicPrompt,
	assistantHasWebSearch,
	getAssistantById,
	processPreprompt,
} from "./assistant";
import { pickTools, runTools } from "./tools";
import type { WebSearch } from "$lib/types/WebSearch";
import {
	type MessageUpdate,
	MessageUpdateType,
	MessageUpdateStatus,
} from "$lib/types/MessageUpdate";
import { generate } from "./generate";
import { mergeAsyncGenerators } from "$lib/utils/mergeAsyncGenerators";
import type { TextGenerationContext } from "./types";
import type { ToolResult } from "$lib/types/Tool";
import { toolHasName } from "../tools/utils";
import directlyAnswer from "../tools/directlyAnswer";

export async function* textGeneration(ctx: TextGenerationContext) {
	yield* mergeAsyncGenerators([
		textGenerationWithoutTitle(ctx),
		generateTitleForConversation(ctx.conv),
	]);
}

async function* textGenerationWithoutTitle(
	ctx: TextGenerationContext
): AsyncGenerator<MessageUpdate, undefined, undefined> {
	yield {
		type: MessageUpdateType.Status,
		status: MessageUpdateStatus.Started,
	};

	ctx.assistant ??= await getAssistantById(ctx.conv.assistantId);
	const { model, conv, messages, assistant, isContinue, webSearch, toolsPreference } = ctx;
	const convId = conv._id;

	// perform websearch if requested
	// it can be because the user toggled the webSearch or because the assistant has webSearch enabled
	// if tools are enabled, we don't perform it here since we will add the websearch as a tool
	let webSearchResult: WebSearch | undefined;
	if (
		!isContinue &&
		!model.tools &&
		((webSearch && !conv.assistantId) || assistantHasWebSearch(assistant))
	) {
		webSearchResult = yield* runWebSearch(conv, messages, assistant?.rag);
	}

	let preprompt = conv.preprompt;
	if (assistantHasDynamicPrompt(assistant) && preprompt) {
		preprompt = await processPreprompt(preprompt);
		if (messages[0].from === "system") messages[0].content = preprompt;
	}

	let toolResults: ToolResult[] = [];

	if (model.tools && !conv.assistantId) {
		const tools = pickTools(toolsPreference, Boolean(assistant));
		const toolCallsRequired = tools.some((tool) => !toolHasName(directlyAnswer.name, tool));
		if (toolCallsRequired) toolResults = yield* runTools(ctx, tools, preprompt);
	}

	const processedMessages = await preprocessMessages(messages, webSearchResult, convId);
	yield* generate({ ...ctx, messages: processedMessages }, toolResults, preprompt);
}
