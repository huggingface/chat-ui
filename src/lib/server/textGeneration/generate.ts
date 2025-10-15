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
		conversationId: conv._id,
		locals,
		abortSignal: abortController.signal,
	});

	for await (const output of stream) {
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
				if (!text.endsWith(stopToken)) continue;

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
		if (output.token.special) continue;

		// yield normal token
		yield { type: MessageUpdateType.Stream, token: output.token.text };

		// abort check
		const date = AbortedGenerations.getInstance().getAbortTime(conv._id.toString());

		if (date && date > promptedAt) {
			logger.info(`Aborting generation for conversation ${conv._id}`);
			if (!abortController.signal.aborted) {
				abortController.abort();
			}
			break;
		}

		// no output check
		if (!output) break;
	}
}
