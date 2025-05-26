import type { TextGenerationStreamOutput } from "@huggingface/inference";
import type OpenAI from "openai";
import type { Stream } from "openai/streaming";
import type { ToolCall } from "$lib/types/Tool";

type ToolCallWithParameters = {
	toolCall: ToolCall;
	parameterJsonString: string;
};

function prepareToolCalls(toolCallsWithParameters: ToolCallWithParameters[], tokenId: number) {
	const toolCalls: ToolCall[] = [];

	for (const toolCallWithParameters of toolCallsWithParameters) {
		// HACK: sometimes gpt4 via azure returns the JSON with literal newlines in it
		// like {\n "foo": "bar" }
		const s = toolCallWithParameters.parameterJsonString.replace("\n", "");
		const params = JSON.parse(s);

		const toolCall = toolCallWithParameters.toolCall;
		for (const name in params) {
			toolCall.parameters[name] = params[name];
		}

		toolCalls.push(toolCall);
	}

	const output = {
		token: {
			id: tokenId,
			text: "",
			logprob: 0,
			special: false,
			toolCalls,
		},
		generated_text: null,
		details: null,
	};

	return output;
}

/**
 * Transform a stream of OpenAI.Chat.ChatCompletion into a stream of TextGenerationStreamOutput
 */
export async function* openAIChatToTextGenerationStream(
	completionStream: Stream<OpenAI.Chat.Completions.ChatCompletionChunk>
) {
	let generatedText = "";
	let tokenId = 0;
	const toolCalls: ToolCallWithParameters[] = [];
	let toolBuffer = ""; // XXX: hack because tools seem broken on tgi openai endpoints?

	for await (const completion of completionStream) {
		const { choices } = completion;
		const content = choices[0]?.delta?.content ?? "";
		const last = choices[0]?.finish_reason === "stop" || choices[0]?.finish_reason === "length";

		// if the last token is a stop and the tool buffer is not empty, yield it as a generated_text
		if (choices[0]?.finish_reason === "stop" && toolBuffer.length > 0) {
			yield {
				token: {
					id: tokenId++,
					special: true,
					logprob: 0,
					text: "",
				},
				generated_text: toolBuffer,
				details: null,
			} as TextGenerationStreamOutput;
			break;
		}

		// weird bug where the parameters are streamed in like this
		if (choices[0]?.delta?.tool_calls) {
			const calls = Array.isArray(choices[0].delta.tool_calls)
				? choices[0].delta.tool_calls
				: [choices[0].delta.tool_calls];

			if (
				calls.length === 1 &&
				calls[0].index === 0 &&
				calls[0].id === "" &&
				calls[0].type === "function" &&
				!!calls[0].function &&
				calls[0].function.name === null
			) {
				toolBuffer += calls[0].function.arguments;
				continue;
			}
		}

		if (content) {
			generatedText = generatedText + content;
		}
		const output: TextGenerationStreamOutput = {
			token: {
				id: tokenId++,
				text: content ?? "",
				logprob: 0,
				special: last,
			},
			generated_text: last ? generatedText : null,
			details: null,
		};
		yield output;

		const tools = completion.choices[0]?.delta?.tool_calls || [];
		for (const tool of tools) {
			if (tool.id) {
				if (!tool.function?.name) {
					throw new Error("Tool call without function name");
				}
				const toolCallWithParameters: ToolCallWithParameters = {
					toolCall: {
						name: tool.function.name,
						parameters: {},
						toolId: tool.id,
					},
					parameterJsonString: "",
				};
				toolCalls.push(toolCallWithParameters);
			}

			if (toolCalls.length > 0 && tool.function?.arguments) {
				toolCalls[toolCalls.length - 1].parameterJsonString += tool.function.arguments;
			}
		}

		if (choices[0]?.finish_reason === "tool_calls") {
			yield prepareToolCalls(toolCalls, tokenId++);
		}
	}
}

/**
 * Transform a non-streaming OpenAI chat completion into a stream of TextGenerationStreamOutput
 */
export async function* openAIChatToTextGenerationSingle(
	completion: OpenAI.Chat.Completions.ChatCompletion
) {
	const content = completion.choices[0]?.message?.content || "";
	const tokenId = 0;

	// Yield the content as a single token
	yield {
		token: {
			id: tokenId,
			text: content,
			logprob: 0,
			special: false,
		},
		generated_text: content,
		details: null,
	} as TextGenerationStreamOutput;
}
