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
	for await (const completion of completionStream) {
		const { choices } = completion;
		const content = choices[0]?.delta?.content ?? "";
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
		yield output;
	}
}
