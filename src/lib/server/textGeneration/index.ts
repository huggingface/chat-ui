import { preprocessMessages } from "../endpoints/preprocessMessages";

import { generateTitleForConversation } from "./title";
import { injectArtifactsPrompt } from "./artifacts";
import {
	type MessageUpdate,
	MessageUpdateType,
	MessageUpdateStatus,
} from "$lib/types/MessageUpdate";
import { generate } from "./generate";
import { runMcpFlow } from "./mcp/runMcpFlow";
import { mergeAsyncGenerators } from "$lib/utils/mergeAsyncGenerators";
import type { TextGenerationContext } from "./types";

/** Updates that mean the user has already been shown something for this turn. */
function isVisibleWork(update: MessageUpdate): boolean {
	return (
		update.type === MessageUpdateType.Stream ||
		update.type === MessageUpdateType.Tool ||
		update.type === MessageUpdateType.Reasoning ||
		update.type === MessageUpdateType.FinalAnswer
	);
}

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

	// Artifacts are opt-in per model (supportsArtifacts in the MODELS overrides),
	// with a per-model user override from the model settings page
	const preprompt =
		(ctx.artifactsOverride ?? ctx.model.supportsArtifacts)
			? injectArtifactsPrompt(conv.preprompt)
			: conv.preprompt;

	const processedMessages = await preprocessMessages(messages, convId);

	let mcpProducedOutput = false;

	// Try MCP tool flow first; fall back to default generation if not selected/available
	try {
		const mcpGen = runMcpFlow({
			model: ctx.model,
			conv,
			messages: processedMessages,
			assistant: ctx.assistant,
			forceMultimodal: ctx.forceMultimodal,
			forceTools: ctx.forceTools,
			provider: ctx.provider,
			reasoningEffort: ctx.reasoningEffort,
			reasoningOverride: ctx.reasoningOverride,
			locals: ctx.locals,
			preprompt,
			abortSignal: ctx.abortController.signal,
			abortController: ctx.abortController,
			promptedAt: ctx.promptedAt,
			generationId: ctx.generationId,
			messageId: ctx.messageId,
		});

		let step = await mcpGen.next();
		while (!step.done) {
			if (isVisibleWork(step.value)) mcpProducedOutput = true;
			yield step.value;
			step = await mcpGen.next();
		}
		const mcpResult = step.value;
		// `!mcpProducedOutput` is not redundant with the result: runMcpFlow catches its own
		// errors, so a failure could still surface here as "not_applicable" rather than a
		// throw, and re-running would discard whatever the user has already been shown.
		if (mcpResult === "not_applicable" && !mcpProducedOutput) {
			// fallback to normal text generation
			yield* generate({ ...ctx, messages: processedMessages }, preprompt);
		}
		// Every other result already emitted a final answer; falling back would replace it.
	} catch (err) {
		// Don't fall back on abort errors - user intentionally stopped
		const isAbort =
			ctx.abortController.signal.aborted ||
			(err instanceof Error &&
				(err.name === "AbortError" ||
					err.name === "APIUserAbortError" ||
					err.message.includes("Request was aborted")));
		if (isAbort) {
			// nothing to recover; the partial message is already what the user saw
		} else if (mcpProducedOutput) {
			// Falling back here would discard the tool work and answer as if none of it ran.
			throw err;
		} else {
			// Nothing was shown yet, so a clean tool-free retry is a real recovery.
			yield* generate({ ...ctx, messages: processedMessages }, preprompt);
		}
	}
	done.abort();
}
