import { z } from "zod";
import type { Endpoint } from "../endpoints";
import { env } from "$env/dynamic/private";
import type { TextGenerationStreamOutput } from "@huggingface/inference";
import { createImageProcessorOptionsValidator } from "../images";
import { endpointMessagesToAnthropicMessages } from "./utils";
import type {
	Tool,
	ToolCall,
	ToolInput,
	ToolInputFile,
	ToolInputFixed,
	ToolInputOptional,
	ToolResult,
} from "$lib/types/Tool";
import type Anthropic from "@anthropic-ai/sdk";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages.mjs";

export const endpointAnthropicParametersSchema = z.object({
	weight: z.number().int().positive().default(1),
	model: z.any(),
	type: z.literal("anthropic"),
	baseURL: z.string().url().default("https://api.anthropic.com"),
	apiKey: z.string().default(env.ANTHROPIC_API_KEY ?? "sk-"),
	defaultHeaders: z.record(z.string()).optional(),
	defaultQuery: z.record(z.string()).optional(),
	multimodal: z
		.object({
			image: createImageProcessorOptionsValidator({
				supportedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
				preferredMimeType: "image/webp",
				// The 4 / 3 compensates for the 33% increase in size when converting to base64
				maxSizeInMB: (5 / 4) * 3,
				maxWidth: 4096,
				maxHeight: 4096,
			}),
		})
		.default({}),
});

export async function endpointAnthropic(
	input: z.input<typeof endpointAnthropicParametersSchema>
): Promise<Endpoint> {
	const { baseURL, apiKey, model, defaultHeaders, defaultQuery, multimodal } =
		endpointAnthropicParametersSchema.parse(input);
	let Anthropic;
	try {
		Anthropic = (await import("@anthropic-ai/sdk")).default;
	} catch (e) {
		throw new Error("Failed to import @anthropic-ai/sdk", { cause: e });
	}

	const anthropic = new Anthropic({
		apiKey,
		baseURL,
		defaultHeaders,
		defaultQuery,
	});

	// get tool results and tools from this call
	// convert from library to anthropic format of tools
	// check if model has tools enabled
	// process toolresults and add them to the request
	// add a toolcall yield if the model stops for tool calling reasons.
	return async ({ messages, preprompt, generateSettings, tools, toolResults }) => {
		let system = preprompt;
		if (messages?.[0]?.from === "system") {
			system = messages[0].content;
		}

		let tokenId = 0;

		const parameters = { ...model.parameters, ...generateSettings };

		let anthropicTools: Anthropic.Messages.Tool[] = [];

		if (model.tools && tools && tools.length > 0) {
			anthropicTools = createAnthropicTools(tools);
		}
		anthropicTools.reverse().shift();
		console.log(JSON.stringify(anthropicTools));
		// Example tool for weather
		const weatherTool: Anthropic.Messages.Tool[] = [
			{
				name: "get_weather",
				description: "Get the current weather in a given location",
				input_schema: {
					type: "object",
					properties: {
						location: {
							type: "string",
							description: "The city and state, e.g. San Francisco, CA",
						},
						unit: {
							type: "string",
							enum: ["celsius", "fahrenheit"],
							description: "The unit of temperature, either 'celsius' or 'fahrenheit'",
						},
					},
					required: ["location"],
				},
			},
		];

		const calculatorTool: Anthropic.Messages.Tool[] = [
			{
				name: "calculator",
				description: "Calculate the result of a mathematical expression",
				input_schema: {
					type: "object",
					properties: {
						equation: {
							description:
								"A mathematical expression to be evaluated. The result of the expression will be returned.",
							type: "string",
						},
					},
					required: ["equation"],
				},
			},
		];

		console.log("-------------");
		console.log(JSON.stringify(weatherTool));
		/*		if (!model.tools) {
			anthropicTools = weatherTool;
		}
			
*/

		let anthropic_messages = await endpointMessagesToAnthropicMessages(messages, multimodal);
		if (toolResults && toolResults.length > 0) {
			anthropic_messages = addToolResults(anthropic_messages, toolResults);
		}

		//		console.log(JSON.stringify(anthropic_messages));
		return (async function* () {
			const stream = anthropic.messages.stream({
				model: model.id ?? model.name,
				tools: calculatorTool,
				tool_choice: { type: "auto", disable_parallel_tool_use: false },
				messages: anthropic_messages,
				max_tokens: parameters?.max_new_tokens,
				temperature: parameters?.temperature,
				top_p: parameters?.top_p,
				top_k: parameters?.top_k,
				stop_sequences: parameters?.stop,
				system,
			});
			while (true) {
				const result = await Promise.race([
					//					stream.emitted("inputJson"),
					stream.emitted("text"),
					stream.emitted("end"),
				]);

				// Stream end
				if (result === undefined) {
					stream.receivedMessages.forEach((message) => {
						console.log("--->" + message.id + "..." + message.stop_reason + ".." + message.type);
						message.content.forEach((contentBlock) => {
							if (contentBlock.type === "tool_use") {
								console.log(
									"Tool call:",
									contentBlock.id + contentBlock.name + JSON.stringify(contentBlock.input)
								);
							}
						});
					});

					if ("tool_use" === stream.receivedMessages[0].stop_reason) {
						const toolCalls: ToolCall[] = stream.receivedMessages[0].content
							.filter(
								(block): block is Anthropic.Messages.ContentBlock & { type: "tool_use" } =>
									block.type === "tool_use"
							)
							.map((block) => ({
								name: block.name,
								parameters: block.input as Record<string, string | number | boolean>,
								id: block.id,
							}));

						yield {
							token: { id: tokenId, text: "", logprob: 0, special: false, toolCalls },
							generated_text: null,
							details: null,
						};
					} else {
						yield {
							token: {
								id: tokenId++,
								text: "",
								logprob: 0,
								special: true,
							},
							generated_text: await stream.finalText(),
							details: null,
						} satisfies TextGenerationStreamOutput;
					}

					return;
				}

				yield {
					token: {
						id: tokenId++,
						text: result as unknown as string,
						special: false,
						logprob: 0,
					},
					generated_text: null,
					details: null,
				} satisfies TextGenerationStreamOutput;
			}
		})();
	};
}

function addToolResults(messages: MessageParam[], toolResults: ToolResult[]): MessageParam[] {
	const assistantMessages: MessageParam[] = [];
	const userMessages: MessageParam[] = [];

	assistantMessages.push({
		role: "assistant",
		content: [
			{
				type: "tool_use",
				id: "any_id",
				name: toolResults[0].call.name,
				input: toolResults[0].call.parameters, // Changed from JSON.stringify to direct object
			},
		],
	});

	userMessages.push({
		role: "user",
		content: [
			{
				type: "tool_result",
				tool_use_id: "any_id",
				is_error: toolResults[0].status === "error",
				content:
					toolResults[0].status === "error"
						? JSON.stringify(toolResults[0].message) // Include error message if it's an error
						: JSON.stringify("outputs" in toolResults[0] ? toolResults[0].outputs : ""), // Otherwise include the output
			},
		],
	});

	return [...messages, ...assistantMessages, ...userMessages];
}

function createAnthropicTools(tools: Tool[]): Anthropic.Messages.Tool[] {
	return tools.map((tool) => {
		const properties = tool.inputs.reduce((acc, input) => {
			acc[input.name] = convertToolInputToJSONSchema(input);
			return acc;
		}, {} as Record<string, unknown>);

		const required = tool.inputs
			.filter((input) => input.paramType === "required")
			.map((input) => input.name);

		return {
			name: tool.name,
			description: tool.description,
			input_schema: {
				type: "object",
				properties,
				required: required.length > 0 ? required : undefined,
			},
		};
	});
}

function convertToolInputToJSONSchema(input: ToolInput): Record<string, unknown> {
	const baseSchema: Record<string, unknown> = {};
	if ("description" in input) {
		baseSchema["description"] = input.description || "";
	}
	switch (input.paramType) {
		case "optional":
			baseSchema["default"] = (input as ToolInputOptional).default;
			break;
		case "fixed":
			baseSchema["const"] = (input as ToolInputFixed).value;
			break;
	}

	if (input.type === "file") {
		baseSchema["type"] = "string";
		baseSchema["format"] = "binary";
		baseSchema["mimeTypes"] = (input as ToolInputFile).mimeTypes;
	} else {
		switch (input.type) {
			case "str":
				baseSchema["type"] = "string";
				break;
			case "int":
				baseSchema["type"] = "integer";
				break;
			case "float":
				baseSchema["type"] = "number";
				break;
			case "bool":
				baseSchema["type"] = "boolean";
				break;
		}
	}

	return baseSchema;
}
