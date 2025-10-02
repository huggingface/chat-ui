import { generateFromDefaultEndpoint } from "../generateFromDefaultEndpoint";
import { getReturnFromGenerator } from "$lib/utils/getReturnFromGenerator";

export async function generateSummaryOfReasoning(
	buffer: string,
	modelId?: string
): Promise<string> {
	let summary: string | undefined;

	// Tools removed: no tool-based summarization path

	if (!summary) {
		summary = await getReturnFromGenerator(
			generateFromDefaultEndpoint({
				messages: [
					{
						from: "user",
						content: buffer.slice(-300),
					},
				],
				preprompt: `You are tasked with summarizing the latest reasoning steps. Never describe results of the reasoning, only the process. Remain vague in your summary.
            The text might be incomplete, try your best to summarize it in one very short sentence, starting with a gerund and ending with three points. 
            Example: "Thinking about life...", "Summarizing the results...", "Processing the input..."`,
				generateSettings: {
					max_tokens: 50,
				},
				modelId,
			})
		);
	}

	if (!summary) {
		return "Reasoning...";
	}

	const parts = summary.split("...");
	return parts[0].slice(0, 100) + "...";
}
