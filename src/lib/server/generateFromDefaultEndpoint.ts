import { defaultModel } from "$lib/server/models";
import { modelEndpoint } from "./modelEndpoint";
import { textGeneration } from "@huggingface/inference";
import { trimSuffix } from "$lib/utils/trimSuffix";
import { trimPrefix } from "$lib/utils/trimPrefix";
import { PUBLIC_SEP_TOKEN } from "$lib/constants/publicSepToken";

export async function generateFromDefaultEndpoint(prompt: string) {
	const parameters = {
		...defaultModel.parameters,
		return_full_text: false,
	};

	const endpoint = modelEndpoint(defaultModel);
	let { generated_text } = await textGeneration(
		{
			model: endpoint.url,
			inputs: prompt,
			parameters,
		},
		{
			fetch: (url, options) =>
				fetch(url, {
					...options,
					headers: { ...options?.headers, Authorization: endpoint.authorization },
				}),
		}
	);

	generated_text = trimSuffix(trimPrefix(generated_text, "<|startoftext|>"), PUBLIC_SEP_TOKEN);

	return generated_text;
}
