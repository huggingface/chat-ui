import { generateFromDefaultEndpoint } from "../generateFromDefaultEndpoint";

import { getReturnFromGenerator } from "$lib/utils/getReturnFromGenerator";
import { logger } from "../logger";

export async function generateSummaryOfReasoning(buffer: string): Promise<string> {
	// debug 5s delay
	await new Promise((resolve) => setTimeout(resolve, 3000));

	const summary = await getReturnFromGenerator(
		generateFromDefaultEndpoint({
			messages: [
				{
					from: "user",
					content: buffer.slice(-200),
				},
			],
			preprompt: `You are tasked with summarizing the latest reasoning steps. Never describe results of the reasoning, only the process. Remain vague in your summary.
            The text might be incomplete, try your best to summarize it in one very short sentence, starting with a gerund and ending with three points. 
            Example: "Thinking about life...", "Summarizing the results...", "Processing the input..."`,
			generateSettings: {
				max_new_tokens: 50,
			},
		})
	)
		.then((summary) => {
			const parts = summary.split("...");
			return parts[0] + "...";
		})
		.catch((e) => {
			logger.error(e);
			return "Reasoning...";
		});

	return summary;
}
