import { generateFromDefaultEndpoint } from "../generateFromDefaultEndpoint";
import { taskModel } from "../models";
import { getReturnFromGenerator } from "$lib/utils/getReturnFromGenerator";
import { getToolOutput } from "../tools/getToolOutput";
import type { Tool } from "$lib/types/Tool";
import { logger } from "../logger";

export async function generateSummaryOfReasoning(buffer: string): Promise<string> {
	let summary: string | undefined;

	const messages = [
		{
			from: "user" as const,
			content: buffer.slice(-300),
		},
	];

	const preprompt = `You are tasked with submitting a summary of the latest reasoning steps into a tool. Never describe results of the reasoning, only the process. Remain vague in your summary.
The text might be incomplete, try your best to summarize it in one very short sentence, starting with a gerund and ending with three points. The sentence must be very short, ideally 5 words or less.`;

	if (taskModel.tools) {
		const summaryTool = {
			name: "summary",
			description: "Submit a summary for the submitted text",
			inputs: [
				{
					name: "summary",
					type: "str",
					description:
						"The short summary of the reasoning steps. 5 words or less. Must start with a gerund.",
					paramType: "required",
				},
			],
		} as unknown as Tool;

		const endpoint = await taskModel.getEndpoint();
		summary = await getToolOutput({
			messages,
			preprompt,
			tool: summaryTool,
			endpoint,
		}).catch(() => {
			logger.warn("Error getting tool output");
			return undefined;
		});
	}

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
					max_new_tokens: 50,
				},
			})
		);
	}

	if (!summary) {
		return "Reasoning...";
	}

	const parts = summary.split("...");
	return parts[0].slice(0, 100) + "...";
}
