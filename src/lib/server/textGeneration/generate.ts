import { MessageUpdateType, type MessageUpdate } from "$lib/types/MessageUpdate";
import { AbortedGenerations } from "../abortedGenerations";
import type { TextGenerationContext } from "./types";
import type { EndpointMessage } from "../endpoints/endpoints";
import { logger } from "../logger";

type GenerateContext = Omit<TextGenerationContext, "messages"> & { messages: EndpointMessage[] };

export async function* generate(
	{
		model,
		endpoint,
		conv,
		messages,
		assistant,
		promptedAt,
		forceMultimodal,
		locals,
		abortController,
	}: GenerateContext,
	preprompt?: string
): AsyncIterable<MessageUpdate> {
	const stream = await endpoint({
		messages,
		preprompt,
		generateSettings: assistant?.generateSettings,
		// Allow user-level override to force multimodal
		isMultimodal: (forceMultimodal ?? false) || model.multimodal,
		conversationId:
			(conv as { _id?: unknown; id?: string }).id || String((conv as { _id?: unknown })._id),
		locals,
		abortSignal: abortController.signal,
	});

	for await (const output of stream) {
		// Check if this output contains debug information (from litellm security handler)
		if ("debugInfo" in output && output.debugInfo) {
			const debug = output.debugInfo as {
				originalRequest?: unknown;
				securityResponse?: { action: string; reason?: string; modifiedKwargs?: unknown };
				securityResponseTime?: number;
				llmRequest?: unknown;
				finalLlmResponse?: unknown;
				llmResponseTime?: number;
				totalTime?: number;
				error?: string;
			};
			yield {
				type: MessageUpdateType.Debug,
				originalRequest: debug.originalRequest as {
					model?: string;
					messages?: unknown[];
					[key: string]: unknown;
				},
				securityResponse: debug.securityResponse as {
					action: "allow" | "block" | "modify";
					reason?: string;
					modifiedKwargs?: Record<string, unknown>;
				},
				securityResponseTime: debug.securityResponseTime,
				llmRequest: debug.llmRequest as {
					model?: string;
					messages?: unknown[];
					stream?: boolean;
					_stream_overridden?: boolean;
					[key: string]: unknown;
				},
				finalLlmResponse: debug.finalLlmResponse as {
					id?: string;
					choices?: unknown[];
					model?: string;
					usage?: unknown;
					[key: string]: unknown;
				},
				llmResponseTime: debug.llmResponseTime,
				totalTime: debug.totalTime,
				error: debug.error,
			};
			// Continue processing even if debug info is present
		}

		// Check if this output contains router metadata
		if (
			"routerMetadata" in output &&
			output.routerMetadata &&
			((output.routerMetadata.route && output.routerMetadata.model) ||
				output.routerMetadata.provider)
		) {
			yield {
				type: MessageUpdateType.RouterMetadata,
				route: output.routerMetadata.route || "",
				model: output.routerMetadata.model || "",
				provider: output.routerMetadata.provider,
			};
			continue;
		}
		// text generation completed
		if (output.generated_text) {
			let interrupted =
				!output.token.special && !model.parameters.stop?.includes(output.token.text);

			let text = output.generated_text.trimEnd();
			for (const stopToken of model.parameters.stop ?? []) {
				if (!text.endsWith(stopToken)) {
					continue;
				}

				interrupted = false;
				text = text.slice(0, text.length - stopToken.length);
			}

			yield {
				type: MessageUpdateType.FinalAnswer,
				text,
				interrupted,
			};
			continue;
		}

		// ignore special tokens
		if (output.token.special) {
			continue;
		}

		// yield normal token
		yield { type: MessageUpdateType.Stream, token: output.token.text };

		// abort check
		const convId =
			(conv as { _id?: unknown; id?: string }).id || String((conv as { _id?: unknown })._id);
		const date = AbortedGenerations.getInstance().getAbortTime(convId);

		if (date && date > promptedAt) {
			logger.info(`Aborting generation for conversation ${convId}`);
			if (!abortController.signal.aborted) {
				abortController.abort();
			}
			break;
		}

		// no output check
		if (!output) {
			break;
		}
	}
}
