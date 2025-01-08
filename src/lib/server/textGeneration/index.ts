import { runWebSearch } from "$lib/server/websearch/runWebSearch";
import { preprocessMessages } from "../endpoints/preprocessMessages";

import { generateTitleForConversation } from "./title";
import {
	assistantHasDynamicPrompt,
	assistantHasWebSearch,
	getAssistantById,
	processPreprompt,
} from "./assistant";
import { getTools, runTools } from "./tools";
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

async function* keepAlive(done: AbortSignal): AsyncGenerator<MessageUpdate, undefined, undefined> {
	while (!done.aborted) {
		yield {
			type: MessageUpdateType.Status,
			status: MessageUpdateStatus.KeepAlive,
		};
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
}

export async function* textGeneration(ctx: TextGenerationContext) {
	const done = new AbortController();

	const titleGen = generateTitleForConversation(ctx.conv);
	const textGen = textGenerationWithoutTitle(ctx, done);
	const keepAliveGen = keepAlive(done.signal);

	// keep alive until textGen is done

	yield* mergeAsyncGenerators([titleGen, textGen, keepAliveGen]);
}

async function* textGenerationWithoutTitle(
	ctx: TextGenerationContext,
	done: AbortController
): AsyncGenerator<MessageUpdate, undefined, undefined> {
	yield {
		type: MessageUpdateType.Status,
		status: MessageUpdateStatus.Started,
	};

	ctx.assistant ??= await getAssistantById(ctx.conv.assistantId);
	const { model, conv, messages, assistant, isContinue, webSearch, toolsPreference } = ctx;
	const convId = conv._id;

	let webSearchResult: WebSearch | undefined;

	// run websearch if:
	// - it's not continuing a previous message
	// - AND the model doesn't support tools and websearch is selected
	// - OR the assistant has websearch enabled (no tools for assistants for now)
	if (!isContinue && ((webSearch && !conv.assistantId) || assistantHasWebSearch(assistant))) {
		webSearchResult = yield* runWebSearch(conv, messages, assistant?.rag);
	}

	let preprompt = conv.preprompt;
	if (assistantHasDynamicPrompt(assistant) && preprompt) {
		preprompt = await processPreprompt(preprompt, messages.at(-1)?.content);
		if (messages[0].from === "system") messages[0].content = preprompt;
	}

	let toolResults: ToolResult[] = [];
	let tools = model.tools ? await getTools(toolsPreference, ctx.assistant) : undefined;

	if (tools) {
		const toolCallsRequired = tools.some((tool) => !toolHasName(directlyAnswer.name, tool));
		if (toolCallsRequired) {
			toolResults = yield* runTools(ctx, tools, preprompt);
		} else tools = undefined;
	}

	const processedMessages = await preprocessMessages(messages, webSearchResult, convId);
	yield* generate({ ...ctx, messages: processedMessages }, toolResults, preprompt);
	done.abort();
}
