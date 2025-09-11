import type { TextGenerationStreamOutput } from "@huggingface/inference";
import type OpenAI from "openai";
import type { Stream } from "openai/streaming";

/**
 * Transform a stream of OpenAI.Chat.ChatCompletion into a stream of TextGenerationStreamOutput
 */
export async function* openAIChatToTextGenerationStream(
	completionStream: Stream<OpenAI.Chat.Completions.ChatCompletionChunk>
) {
	let generatedText = "";
	let tokenId = 0;
	let toolBuffer = ""; // legacy hack kept harmless
	let thinkOpen = false;

	for await (const completion of completionStream) {
		const { choices } = completion;
		const delta: any = choices?.[0]?.delta ?? {};
		const content: string = (delta?.content as string) ?? "";
		const reasoning: string =
			typeof delta?.reasoning === "string"
				? (delta.reasoning as string)
				: typeof delta?.reasoning_content === "string"
					? (delta.reasoning_content as string)
					: "";
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

		let combined = "";
		if (reasoning && reasoning.length > 0) {
			if (!thinkOpen) {
				combined += "<think>" + reasoning;
				thinkOpen = true;
			} else {
				combined += reasoning;
			}
		}

		if (content && content.length > 0) {
			const trimmed = content.trim();
			// If provider sends a lone closing tag with no prior <think>, drop it.
			if (!thinkOpen && trimmed === "</think>") {
				// ignore stray closing tag
			} else if (thinkOpen && trimmed === "</think>") {
				// close once without duplicating the tag
				combined += "</think>";
				thinkOpen = false;
			} else if (thinkOpen) {
				combined += "</think>" + content;
				thinkOpen = false;
			} else {
				combined += content;
			}
		}

		// Accumulate the combined token into the full text
		generatedText += combined;
		const output: TextGenerationStreamOutput = {
			token: {
				id: tokenId++,
				text: combined,
				logprob: 0,
				special: last,
			},
			generated_text: last ? generatedText : null,
			details: null,
		};
		yield output;

		// Tools removed: ignore tool_calls deltas
	}
}

/**
 * Transform a non-streaming OpenAI chat completion into a stream of TextGenerationStreamOutput
 */
export async function* openAIChatToTextGenerationSingle(
	completion: OpenAI.Chat.Completions.ChatCompletion
) {
	const message: any = completion.choices?.[0]?.message ?? {};
	let content: string = message?.content || "";
	// Provider-dependent reasoning shapes (non-streaming)
	const r: string =
		typeof message?.reasoning === "string"
			? (message.reasoning as string)
			: typeof message?.reasoning_content === "string"
				? (message.reasoning_content as string)
				: "";
	if (r && r.length > 0) {
		content = `<think>${r}</think>` + content;
	}
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
