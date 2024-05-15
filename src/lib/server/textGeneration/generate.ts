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
	let buffer = "";
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
		}

		// todo: and if there is a special token?
		if (!output.token.special) {
			buffer += output.token.text;

			// send 5 chars and leave the rest in the buffer
			if (buffer.length >= 5) {
				yield {
					type: TextGenerationUpdateType.Stream,
					token: buffer.slice(0, 5),
				};
				buffer = buffer.slice(5);
			}

			// abort check
			const date = AbortedGenerations.getInstance().getList().get(conv._id.toString());
			if (date && date > promptedAt) break;

			// no output check
			if (!output) break;
		}
	}

	// pass down the remaining buffer
	// TODO: ensure this happens before the final answer
	// if (buffer) {
	// 	yield {
	// 		type: TextGenerationUpdateType.Stream,
	// 		token: buffer,
	// 	};
	// }
}
