import { runWebSearch } from "$lib/server/websearch/runWebSearch";
import { preprocessMessages } from "$lib/server/preprocessMessages.js";

import { generateTitle } from "./title";
import {
	assistantHasDynamicPrompt,
	assistantHasWebSearch,
	getAssistantById,
	processPreprompt,
} from "./assistant";
import { pickTools, runTools } from "./tools";
import type { WebSearch } from "$lib/types/WebSearch";
import {
	type TextGenerationUpdate,
	TextGenerationUpdateType,
	TextGenerationStatus,
	type TextGenerationContext,
} from "./types";
import { generate } from "./generate";

export async function* textGeneration(
	ctx: TextGenerationContext
): AsyncIterable<TextGenerationUpdate> {
	yield {
		type: TextGenerationUpdateType.Status,
		status: TextGenerationStatus.Started,
	};

	ctx.assistant ??= await getAssistantById(ctx.conv.assistantId);
	const { model, conv, messages, assistant, isContinue, webSearch, toolsPreference } = ctx;
	const convId = conv._id;

	// TODO: should be a better way to detect if the conversation is new
	// TODO: dont wait for this
	let titlePromise: Promise<string> | undefined;
	if (conv.title === "New Chat" && conv.messages.length === 3) {
		titlePromise = generateTitle(conv.messages[1].content).then((title) => title ?? "New Chat");
	}

	// perform websearch if requested
	// it can be because the user toggled the webSearch or because the assistant has webSearch enabled
	// if functions are enabled, we don't perform it here since we will add the websearch as a tool
	let webSearchResult: WebSearch | undefined;
	if (
		!isContinue &&
		!model.functions &&
		((webSearch && !conv.assistantId) || assistantHasWebSearch(assistant))
	) {
		webSearchResult = yield* runWebSearch(conv, messages, { ragSettings: assistant?.rag });
	}

	// process preprompt
	let preprompt = conv.preprompt;
	if (assistantHasDynamicPrompt(assistant) && preprompt) {
		preprompt = await processPreprompt(preprompt);
		if (messages[0].from === "system") messages[0].content = preprompt;
	}

	const tools = pickTools(toolsPreference, Boolean(assistant));
	const toolResults = yield* runTools(ctx, tools, preprompt);

	const processedMessages = await preprocessMessages(
		messages,
		webSearchResult,
		model.multimodal,
		convId
	);
	yield* generate({ ...ctx, messages: processedMessages }, toolResults, preprompt);

	if (titlePromise) {
		yield {
			type: TextGenerationUpdateType.Title,
			title: await titlePromise,
		};
	}
}
