import { smallModel } from "$lib/server/models";
import { MessageUpdateType, type MessageUpdate } from "$lib/types/MessageUpdate";
import type { EndpointMessage } from "./endpoints/endpoints";

export async function* generateFromDefaultEndpoint({
	messages,
	preprompt,
	generateSettings,
}: {
	messages: EndpointMessage[];
	preprompt?: string;
	generateSettings?: Record<string, unknown>;
}): AsyncGenerator<MessageUpdate, string, undefined> {
	const endpoint = await smallModel.getEndpoint();

	const tokenStream = await endpoint({ messages, preprompt, generateSettings });

	for await (const output of tokenStream) {
		// if not generated_text is here it means the generation is not done
		if (output.generated_text) {
			let generated_text = output.generated_text;
			for (const stop of [...(smallModel.parameters?.stop ?? []), "<|endoftext|>"]) {
				if (generated_text.endsWith(stop)) {
					generated_text = generated_text.slice(0, -stop.length).trimEnd();
				}
			}
			return generated_text;
		}
		yield {
			type: MessageUpdateType.Stream,
			token: output.token.text,
		};
	}
	throw new Error("Generation failed");
}
