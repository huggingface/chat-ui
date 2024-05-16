import type { ToolResult } from "$lib/types/Tool";
import {
	TextGenerationUpdateType,
	type TextGenerationContext,
	type TextGenerationUpdate,
} from "./types";
import { AbortedGenerations } from "../abortedGenerations";

export async function* generate(
	{ model, endpoint, conv, messages, assistant, isContinue, promptedAt }: TextGenerationContext,
	toolResults: ToolResult[],
	preprompt?: string
): AsyncIterable<TextGenerationUpdate> {
	for await (const output of await endpoint({
		messages,
		preprompt,
		continueMessage: isContinue,
		generateSettings: assistant?.generateSettings,
		toolResults,
	})) {
		if (output.generated_text) {
			let interrupted =
				!output.token.special && !model.parameters.stop?.includes(output.token.text);

			let text = output.generated_text.trimEnd();
			for (const stopToken of model.parameters.stop ?? []) {
				if (!text.endsWith(stopToken)) continue;

				interrupted = false;
				text = text.slice(0, text.length - stopToken.length);
			}

			yield { type: TextGenerationUpdateType.FinalAnswer, text, interrupted };
			continue;
		}

		// ignore special tokens
		if (output.token.special) continue;

		// pass down normal token
		yield { type: TextGenerationUpdateType.Stream, token: output.token.text };

		// abort check
		const date = AbortedGenerations.getInstance().getList().get(conv._id.toString());
		if (date && date > promptedAt) break;

		// no output check
		if (!output) break;
	}
}
