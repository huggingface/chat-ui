import { preprocessMessages } from "../endpoints/preprocessMessages";

import { generateTitleForConversation } from "./title";
import {
	type MessageUpdate,
	MessageUpdateType,
	MessageUpdateStatus,
} from "$lib/types/MessageUpdate";
import { generate } from "./generate";
import { runMcpFlow } from "./mcp/runMcpFlow";
import { mergeAsyncGenerators } from "$lib/utils/mergeAsyncGenerators";
import type { TextGenerationContext } from "./types";
import { handleWebSearch, enhanceMessageWithWebSearch } from "./webSearchIntegration";

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

	const titleGen = generateTitleForConversation(ctx.conv, ctx.locals);
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

	const { conv, messages } = ctx;
	const convId = conv._id;

	const preprompt = conv.preprompt;

	// Handle web search if needed
	let webSearchSources: { title?: string; link: string }[] = [];
	const lastMessage = messages[messages.length - 1];
	
	if (lastMessage && lastMessage.from === 'user') {
		// Create a mock update function for web search
		const webSearchUpdate = async (event: MessageUpdate) => {
			// This will be handled by the main update function in the conversation endpoint
			// For now, we'll just collect the sources
			if (event.type === MessageUpdateType.WebSearchSources) {
				webSearchSources = event.sources;
			}
		};

		// Process web search
		const webSearchResult = await handleWebSearch(
			await preprocessMessages(messages, convId),
			webSearchUpdate
		).next();
		
		if (webSearchResult.value?.sources) {
			webSearchSources = webSearchResult.value.sources;
		}
	}

	const processedMessages = await preprocessMessages(messages, convId);
	
	// Enhance the last message with web search context if we have results
	if (webSearchSources.length > 0 && processedMessages.length > 0) {
		const lastProcessedMessage = processedMessages[processedMessages.length - 1];
		if (lastProcessedMessage.role === 'user') {
			lastProcessedMessage.content = enhanceMessageWithWebSearch(
				lastProcessedMessage.content,
				webSearchSources
			);
		}
	}

	yield* generate({ ...ctx, messages: processedMessages }, preprompt);

	// Try MCP tool flow first; fall back to default generation if not selected/available
	try {
		const mcpGen = runMcpFlow({
			model: ctx.model,
			conv,
			messages: processedMessages,
			assistant: ctx.assistant,
			forceMultimodal: ctx.forceMultimodal,
			forceTools: ctx.forceTools,
			locals: ctx.locals,
			preprompt,
			abortSignal: ctx.abortController.signal,
		});

		let step = await mcpGen.next();
		while (!step.done) {
			yield step.value;
			step = await mcpGen.next();
		}
		const didRunMcp = Boolean(step.value);
		if (!didRunMcp) {
			// fallback to normal text generation
			yield* generate({ ...ctx, messages: processedMessages }, preprompt);
		}
	} catch {
		// On any MCP error, fall back to normal generation
		yield* generate({ ...ctx, messages: processedMessages }, preprompt);
	}
	done.abort();
}
