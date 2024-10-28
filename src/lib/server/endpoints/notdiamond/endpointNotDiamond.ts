import { z } from "zod";
import type { Endpoint } from "../endpoints";
import { NotDiamond, SupportedModel } from "notdiamond";
import { getEndpoint, modelsRaw, processModel } from "$lib/server/models";

export const endpointNotDiamondSchema = z.object({
	weight: z.number().int().positive().default(1),
	model: z.any(),
	type: z.literal("notdiamond"),
});

const modelsMapping = z.record(
	z.enum(Object.values(SupportedModel) as [string, ...string[]]),
	z.string()
);

export async function endpointNotdiamond(
	input: z.input<typeof endpointNotDiamondSchema>
): Promise<Endpoint> {
	const llmProviders = input.model.llmProviders;
	const notDiamond = new NotDiamond();

	const ND_MODELS_TO_HF_MODELS: z.input<typeof modelsMapping> = {
		"Meta-Llama-3.1-70B-Instruct-Turbo": "meta-llama/Meta-Llama-3.1-70B-Instruct",
		"Qwen2-72B-Instruct": "Qwen/Qwen2.5-72B-Instruct",
		"open-mistral-nemo": "mistralai/Mistral-Nemo-Instruct-2407",
	};

	return async ({ messages, ...rest }) => {
		const ndMessages = messages.map(({ content, from }) => ({ content, role: from }));
		const modelSelect = await notDiamond.modelSelect({
			messages: ndMessages,
			llmProviders,
			tradeoff: "cost",
		});

		const lastMessage = messages[messages.length - 1];

		if (!("providers" in modelSelect) || !modelSelect.providers?.[0]?.model) {
			throw new Error("No suitable model found");
		}

		const currentModel = modelsRaw.find(
			(model) => model.name === ND_MODELS_TO_HF_MODELS[modelSelect.providers[0].model]
		);

		if (!currentModel) {
			throw new Error(`Model ${modelSelect.providers[0].model} not found in mapping`);
		}

		const messagesWithLlmUsed = [
			...messages.slice(0, -1),
			{
				...lastMessage,
				content:
					lastMessage.content +
					"\n\n" +
					`IMPORTANT, after you've executed your main instructions provided above, add the following information to the end of the response: Model: ${currentModel?.name}`,
			},
		];

		const m = await processModel(currentModel);
		const endpoint = await getEndpoint(m)();

		return endpoint({ messages: messagesWithLlmUsed, ...rest });
	};
}

export default endpointNotdiamond;
