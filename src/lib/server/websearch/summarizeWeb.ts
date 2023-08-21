import { HF_ACCESS_TOKEN } from "$env/static/private";
import { HfInference } from "@huggingface/inference";
import { defaultModel } from "$lib/server/models";
import type { BackendModel } from "../models";
import { generateFromDefaultEndpoint } from "../generateFromDefaultEndpoint";

export async function summarizeWeb(content: string, query: string, model: BackendModel) {
	// if HF_ACCESS_TOKEN is set, we use a HF dedicated endpoint for summarization
	try {
		if (HF_ACCESS_TOKEN) {
			const summary = (
				await new HfInference(HF_ACCESS_TOKEN).summarization({
					model: "facebook/bart-large-cnn",
					inputs: content,
					parameters: {
						max_length: 512,
					},
				})
			).summary_text;
			return summary;
		}
	} catch (e) {
		console.log(e);
	}

	// else we use the LLM to generate a summary
	const summaryPrompt = defaultModel.webSearchSummaryPromptRender({
		answer: content
			.split(" ")
			.slice(0, model.parameters?.truncate ?? 0)
			.join(" "),
		query: query,
	});
	const summary = await generateFromDefaultEndpoint(summaryPrompt).then((txt: string) =>
		txt.trim()
	);

	return summary;
}
