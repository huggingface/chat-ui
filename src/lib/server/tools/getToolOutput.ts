import type { Tool } from "$lib/types/Tool";
import { extractJson } from "./utils";
import { externalToToolCall } from "../textGeneration/tools";
import { logger } from "../logger";
import type { Endpoint, EndpointMessage } from "../endpoints/endpoints";

interface GetToolOutputOptions {
	messages: EndpointMessage[];
	tool: Tool;
	preprompt?: string;
	endpoint: Endpoint;
	generateSettings?: {
		max_new_tokens?: number;
		[key: string]: unknown;
	};
}

export async function getToolOutput<T = string>({
	messages,
	preprompt,
	tool,
	endpoint,
	generateSettings = { max_new_tokens: 64 },
}: GetToolOutputOptions): Promise<T | undefined> {
	try {
		const stream = await endpoint({
			messages,
			preprompt: preprompt + `\n\n Only use tool ${tool.name}.`,
			tools: [tool],
			generateSettings,
		});

		const calls = [];

		for await (const output of stream) {
			if (output.token.toolCalls) {
				calls.push(...output.token.toolCalls);
			}
			if (output.generated_text) {
				const extractedCalls = await extractJson(output.generated_text).then((calls) =>
					calls.map((call) => externalToToolCall(call, [tool])).filter((call) => call !== undefined)
				);
				calls.push(...extractedCalls);
			}

			if (calls.length > 0) {
				break;
			}
		}

		if (calls.length > 0) {
			// Find the tool call matching our tool
			const toolCall = calls.find((call) => call.name === tool.name);

			// If we found a matching call and it has parameters
			if (toolCall?.parameters) {
				// Get the first parameter value since most tools have a single main parameter
				const firstParamValue = Object.values(toolCall.parameters)[0];
				if (typeof firstParamValue === "string") {
					return firstParamValue as T;
				}
			}
		}

		return undefined;
	} catch (error) {
		logger.warn(error, "Error getting tool output");
		return undefined;
	}
}
