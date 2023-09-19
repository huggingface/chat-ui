import type { TextGenerationStreamOutput } from "@huggingface/inference";
import type OpenAI from "openai";
import type { Stream } from "openai/streaming";

/**
 * Transform a stream of OpenAI.Completions.Completion into a stream of TextGenerationStreamOutput
 *
 * @param SSEncode - encode into SSE Uint8Array format, default is true
 */
export async function* openAICompletionToTextGenerationStream(
	completionStream: Stream<OpenAI.Completions.Completion>,
	abortSignal: AbortSignal,
	SSEncode = true
) {
	let generatedText = "";
	let tokenId = 0;
	const textEncoder = new TextEncoder();
	for await (const completion of completionStream) {
		if (abortSignal.aborted) {
			break;
		}
		const { choices } = completion;
		const { text } = choices[0];
		const last = choices[0]?.finish_reason === "stop";
		generatedText = generatedText + text;
		const output: TextGenerationStreamOutput = {
			token: {
				id: tokenId++,
				text,
				logprob: 0,
				special: last ? true : false,
			},
			generated_text: last ? generatedText : null,
			details: null,
		};
		if (SSEncode) {
			yield textEncoder.encode("data:" + JSON.stringify(output) + "\n\n");
		} else {
			yield output;
		}
	}
}
