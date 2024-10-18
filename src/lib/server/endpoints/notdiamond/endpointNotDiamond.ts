import { z } from "zod";
import type { Endpoint } from "../endpoints";
import type { TextGenerationStreamOutput } from "@huggingface/inference";
import { NotDiamond } from "notdiamond";

export const endpointNotDiamondSchema = z.object({
	weight: z.number().int().positive().default(1),
	model: z.any(),
	type: z.literal("notdiamond"),
});

export async function endpointNotdiamond(
	input: z.input<typeof endpointNotDiamondSchema>
): Promise<Endpoint> {
	const llmProviders = input.model.llmProviders;

	return async ({ messages }) => {
		const notDiamond = new NotDiamond();
		const ndMessages = messages.map(({ content, from }) => ({ content, role: from }));

		return (async function* () {
			let generatedText = "";
			let tokenId = 0;

			const result = await notDiamond.stream({
				messages: ndMessages,
				llmProviders,
			});

			for await (const chunk of result?.stream ?? []) {
				if (!chunk) continue;

				const tokens = chunk.split(/(\s+)/);

				for (const token of tokens) {
					if (!token) continue;

					generatedText += token;

					const output: TextGenerationStreamOutput = {
						generated_text: null,
						token: {
							id: tokenId++,
							text: token,
							logprob: 0,
							special: false,
						},
						details: null,
					};

					yield output;
				}
			}

			const finalOutput: TextGenerationStreamOutput = {
				token: {
					id: tokenId++,
					text: "",
					logprob: 0,
					special: true,
				},
				generated_text:
					generatedText + "\n\n" + "**Recommended Model:** " + (result?.provider.model || ""),
				details: null,
			};
			yield finalOutput;
		})();
	};
}

export default endpointNotdiamond;
