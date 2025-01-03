import { z } from "zod";
import type { Endpoint } from "../endpoints";
import { env } from "$env/dynamic/private";
import type { TextGenerationStreamOutput } from "@huggingface/inference";
import { createImageProcessorOptionsValidator } from "../images";
import { endpointMessagesToAnthropicMessages, addToolResults } from "./utils";
import { createDocumentProcessorOptionsValidator } from "../document";
import type {
	Tool,
	ToolCall,
	ToolInput,
	ToolInputFile,
	ToolInputFixed,
	ToolInputOptional,
} from "$lib/types/Tool";
import type Anthropic from "@anthropic-ai/sdk";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages.mjs";
import directlyAnswer from "$lib/server/tools/directlyAnswer";

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

	return async ({
		messages,
		preprompt,
		generateSettings,
		conversationId,
		tools = [],
		toolResults = [],
	}) => {
		let system = preprompt;
		if (messages?.[0]?.from === "system") {
			system = messages[0].content;
		}

		let tokenId = 0;
		if (tools.length === 0 && toolResults.length > 0) {
			const toolNames = new Set(toolResults.map((tool) => tool.call.name));
			tools = Array.from(toolNames).map((name) => ({
				name,
				description: "",
				inputs: [],
			})) as unknown as Tool[];
		}

		const parameters = { ...model.parameters, ...generateSettings };

		return (async function* () {
			const stream = anthropic.messages.stream({
				model: model.id ?? model.name,
				tools: createAnthropicTools(tools),
				tool_choice:
					tools.length > 0 ? { type: "auto", disable_parallel_tool_use: false } : undefined,
				messages: addToolResults(
					await endpointMessagesToAnthropicMessages(messages, multimodal, conversationId),
					toolResults
				) as MessageParam[],
				max_tokens: parameters?.max_new_tokens,
				temperature: parameters?.temperature,
				top_p: parameters?.top_p,
				top_k: parameters?.top_k,
				stop_sequences: parameters?.stop,
				system,
			});
			while (true) {
				const result = await Promise.race([stream.emitted("text"), stream.emitted("end")]);

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
				// Text delta
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

function createAnthropicTools(tools: Tool[]): Anthropic.Messages.Tool[] {
	return tools
		.filter((tool) => tool.name !== directlyAnswer.name)
		.map((tool) => {
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
