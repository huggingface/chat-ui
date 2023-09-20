import type { TextGenerationStreamOutput } from "@huggingface/inference";
import type OpenAI from "openai";
import type { Stream } from "openai/streaming";

/**
 * Transform a stream of OpenAI.Chat.ChatCompletion into a stream of TextGenerationStreamOutput
 *
 * @param SSEncode - encode into SSE Uint8Array format, default is true
 */
export async function* openAIChatToTextGenerationStream(
	completionStream: Stream<OpenAI.Chat.Completions.ChatCompletionChunk>,
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
		const {
			delta: { content },
		} = choices[0];
		const last = choices[0]?.finish_reason === "stop";
		if (content) {
			generatedText = generatedText + content;
		}
		const output: TextGenerationStreamOutput = {
			token: {
				id: tokenId++,
				text: content ?? "",
				logprob: 0,
				special: false,
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
