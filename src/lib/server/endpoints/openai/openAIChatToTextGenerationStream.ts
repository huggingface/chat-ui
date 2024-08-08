import type { TextGenerationStreamOutput } from "@huggingface/inference";
import type OpenAI from "openai";
import type { Stream } from "openai/streaming";
import type { UsageInfo } from "$lib/types/Message";
/**
 * Transform a stream of OpenAI.Chat.ChatCompletion into a stream of TextGenerationStreamOutput
 */
export async function* openAIChatToTextGenerationStream(
	completionStream: Stream<OpenAI.Chat.Completions.ChatCompletionChunk>
) {
	let generatedText = "";
	let tokenId = 0;
	let usage: UsageInfo | undefined;

	for await (const completion of completionStream) {
		const { choices } = completion;
		const content = choices[0]?.delta?.content ?? "";
		console.log("**");
		if (content) {
			generatedText += content;
			// Yield intermediate updates without generated_text
			yield {
				token: {
					id: tokenId++,
					text: content,
					logprob: 0,
					special: false,
				},
				generated_text: null,
				details: null,
			} as TextGenerationStreamOutput;
		}

		if (completion.usage) {
			usage = {
				input_tokens: completion.usage.prompt_tokens,
				output_tokens: completion.usage.completion_tokens,
			};
		}
	}

	// Yield the final output with generated_text and usage
	yield {
		token: {
			id: tokenId,
			text: "",
			logprob: 0,
			special: true,
		},
		generated_text: generatedText,
		details: null,
		...(usage && { usage }),
	} as TextGenerationStreamOutput & { usage?: UsageInfo };
}
