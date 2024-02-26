import { smallModel } from "$lib/server/models";
import type { Conversation } from "$lib/types/Conversation";

export async function generateFromDefaultEndpoint({
	messages,
	preprompt,
}: {
	messages: Omit<Conversation["messages"][0], "id">[];
	preprompt?: string;
}): Promise<string> {
	const endpoint = await smallModel.getEndpoint();

	const tokenStream = await endpoint({ messages, preprompt });

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
	}
	throw new Error("Generation failed");
}
