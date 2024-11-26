import { z } from "zod";
import type { Endpoint } from "../endpoints";
import { env } from "$env/dynamic/private";
import type { TextGenerationStreamOutput } from "@huggingface/inference";
import { createImageProcessorOptionsValidator } from "../images";
import { endpointMessagesToAnthropicMessages } from "./utils";
import { createDocumentProcessorOptionsValidator } from "../document";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages.mjs";
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
			document: createDocumentProcessorOptionsValidator({
				supportedMimeTypes: ["application/pdf"],
				maxSizeInMB: 32,
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
		console.log(JSON.stringify(messages));
		let anthropic_messages = await endpointMessagesToAnthropicMessages(messages, multimodal);
		if (toolResults && toolResults.length > 0) {
			anthropic_messages = addToolResults(anthropic_messages, toolResults);
		}

		//		console.log(JSON.stringify(anthropic_messages));
		return (async function* () {
			const stream = anthropic.messages.stream({
				model: model.id ?? model.name,

				tools: anthropicTools,
				tool_choice:
					tools?.length ?? 0 > 0 ? { type: "auto", disable_parallel_tool_use: false } : undefined,
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

				if (result === undefined) {
					if ("tool_use" === stream.receivedMessages[0].stop_reason) {
						// this should really create a new "Assistant" message with the tool id in it.
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

	const [toolUseBlocks, toolResultBlocks] = toolResults.reduce<
		[Anthropic.Messages.ToolUseBlockParam[], Anthropic.Messages.ToolResultBlockParam[]]
	>(
		(acc, toolResult, index) => {
			acc[0].push({
				type: "tool_use",
				id: "tool_" + index,
				name: toolResult.call.name,
				input: toolResult.call.parameters,
			});
			acc[1].push({
				type: "tool_result",
				tool_use_id: "tool_" + index,
				is_error: toolResult.status === "error",
				content:
					toolResult.status === "error"
						? JSON.stringify(toolResult.message)
						: JSON.stringify("outputs" in toolResult ? toolResult.outputs : ""),
			});
			return acc;
		},
		[[], []]
	);

	console.log(JSON.stringify(toolUseBlocks));
	console.log(JSON.stringify(toolResultBlocks));

	assistantMessages.push({
		role: "assistant",
		content: toolUseBlocks,
	});

	userMessages.push({
		role: "user",
		content: toolResultBlocks,
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
