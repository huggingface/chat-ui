import type { TextGenerationStreamOutput } from "@huggingface/inference";
import type OpenAI from "openai";
import type { Stream } from "openai/streaming";

/**
 * Convert a single Completion to an AsyncIterable<Completion>
 */
async function* completionToStream(
	completion: OpenAI.Completions.Completion
): AsyncGenerator<OpenAI.Completions.Completion> {
	yield completion;
}

/**
 * Transform a stream of OpenAI.Completions.Completion into a stream of TextGenerationStreamOutput
 */
export async function* openAICompletionToTextGenerationStream(
	completionStream: Stream<OpenAI.Completions.Completion> | OpenAI.Completions.Completion
) {
	// Handle both Stream and single Completion
	const stream: AsyncIterable<OpenAI.Completions.Completion> =
		Symbol.asyncIterator in completionStream
			? (completionStream as AsyncIterable<OpenAI.Completions.Completion>)
			: completionToStream(completionStream as OpenAI.Completions.Completion);

	let generatedText = "";
	let tokenId = 0;
	for await (const completion of stream) {
		const { choices } = completion;
		const text = choices[0]?.text ?? "";
		const last = choices[0]?.finish_reason === "stop" || choices[0]?.finish_reason === "length";
		if (text) {
			generatedText = generatedText + text;
		}
		const output: TextGenerationStreamOutput = {
			token: {
				id: tokenId++,
				text,
				logprob: 0,
				special: last,
			},
			generated_text: last ? generatedText : null,
			details: null,
		};
		yield output;
	}
}
