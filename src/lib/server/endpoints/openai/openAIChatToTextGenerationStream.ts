import type { TextGenerationStreamOutput } from "@huggingface/inference";
import type OpenAI from "openai";
import type { Stream } from "openai/streaming";

/**
 * Transform a stream of OpenAI.Chat.ChatCompletion into a stream of TextGenerationStreamOutput
 */
export async function* openAIChatToTextGenerationStream(
	completionStream: Stream<OpenAI.Chat.Completions.ChatCompletionChunk>,
	getRouterMetadata?: () => { route?: string; model?: string }
) {
	let generatedText = "";
	let tokenId = 0;
	let toolBuffer = ""; // legacy hack kept harmless
	let metadataYielded = false;

	for await (const completion of completionStream) {
		// Check if this chunk contains router metadata (first chunk from llm-router)
		if (!metadataYielded && (completion as any)['x-router-metadata']) {
			const metadata = (completion as any)['x-router-metadata'];
			yield {
				token: {
					id: tokenId++,
					text: "",
					logprob: 0,
					special: true,
				},
				generated_text: null,
				details: null,
				routerMetadata: {
					route: metadata.route,
					model: metadata.model,
				},
			} as TextGenerationStreamOutput & { routerMetadata: { route: string; model: string } };
			metadataYielded = true;
			// Skip processing this chunk as content since it's just metadata
			if (!completion.choices || completion.choices.length === 0 || !completion.choices[0].delta?.content) {
				continue;
			}
		}
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

		// Tools removed: ignore tool_calls deltas
	}

	// If metadata wasn't yielded from chunks (e.g., from headers), yield it at the end
	if (!metadataYielded && getRouterMetadata) {
		const routerMetadata = getRouterMetadata();
		if (routerMetadata && routerMetadata.route && routerMetadata.model) {
			yield {
				token: {
					id: tokenId++,
					text: "",
					logprob: 0,
					special: true,
				},
				generated_text: null,
				details: null,
				routerMetadata,
			} as TextGenerationStreamOutput & { routerMetadata: { route?: string; model?: string } };
		}
	}
}

/**
 * Transform a non-streaming OpenAI chat completion into a stream of TextGenerationStreamOutput
 */
export async function* openAIChatToTextGenerationSingle(
	completion: OpenAI.Chat.Completions.ChatCompletion,
	getRouterMetadata?: () => { route?: string; model?: string }
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
		...(getRouterMetadata ? (() => {
			const metadata = getRouterMetadata();
			return metadata && metadata.route && metadata.model ? { routerMetadata: metadata } : {};
		})() : {}),
	} as TextGenerationStreamOutput & { routerMetadata?: { route?: string; model?: string } };
}
