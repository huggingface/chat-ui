import { generateFromDefaultEndpoint } from "../generateFromDefaultEndpoint";
import { smallModel } from "../models";
import { getReturnFromGenerator } from "$lib/utils/getReturnFromGenerator";
import { getToolOutput } from "../tools/getToolOutput";
import type { Tool } from "$lib/types/Tool";

export async function generateSummaryOfReasoning(buffer: string): Promise<string> {
	let summary: string | undefined;

	const messages = [
		{
			from: "user" as const,
			content: buffer.slice(-200),
		},
	];

	const preprompt = `You are tasked with submitting a summary of the latest reasoning steps into a tool. Never describe results of the reasoning, only the process. Remain vague in your summary.
The text might be incomplete, try your best to summarize it in one very short sentence, starting with a gerund and ending with three points. 
Example: "Thinking about life...", "Summarizing the results...", "Processing the input...". `;

	if (smallModel.tools) {
		const summaryTool = {
			name: "summary",
			description: "Submit a summary for the submitted text",
			inputs: [
				{
					name: "summary",
					type: "str",
					description: "The short summary of the reasoning steps",
					paramType: "required",
				},
			],
		} as unknown as Tool;

		const endpoint = await smallModel.getEndpoint();
		summary = await getToolOutput({
			messages,
			preprompt,
			tool: summaryTool,
			endpoint,
		});
	}

	if (!summary) {
		summary = await getReturnFromGenerator(
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
		);
	}

	if (!summary) {
		return "Reasoning...";
	}

	const parts = summary.split("...");
	return parts[0].slice(0, 100) + "...";
}
