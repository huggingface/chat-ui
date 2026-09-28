import type { TextGenerationStreamOutput } from "@huggingface/inference";
import type OpenAI from "openai";
import type { Stream } from "openai/streaming";

/**
 * Transform a stream of OpenAI.Chat.ChatCompletion into a stream of TextGenerationStreamOutput
 */
export async function* openAIChatToTextGenerationStream(
	completionStream: Stream<OpenAI.Chat.Completions.ChatCompletionChunk>,
	getRouterMetadata?: () => { route?: string; model?: string; provider?: string }
) {
	let generatedText = "";
	let tokenId = 0;
	let toolBuffer = ""; // legacy hack kept harmless
	let metadataYielded = false;
	let thinkOpen = false;
	// Leading whitespace-only reasoning deltas that arrived before the block
	// opened. Held here and flushed once a non-blank delta opens the block, so a
	// blank chunk can't create an empty <think> on its own while the trace still
	// stays byte-exact. Mirrors runMcpFlow, which does the same for the tool path.
	let pendingReasoningWhitespace = "";

	for await (const completion of completionStream) {
		const retyped = completion as {
			"x-router-metadata"?: { route: string; model: string; provider?: string };
		};
		// Check if this chunk contains router metadata (first chunk from llm-router)
		if (!metadataYielded && retyped["x-router-metadata"]) {
			const metadata = retyped["x-router-metadata"];
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
					provider: metadata.provider,
				},
			} as TextGenerationStreamOutput & {
				routerMetadata: { route: string; model: string; provider?: string };
			};
			metadataYielded = true;
			// Skip processing this chunk as content since it's just metadata
			if (
				!completion.choices ||
				completion.choices.length === 0 ||
				!completion.choices[0].delta?.content
			) {
				continue;
			}
		}
		const { choices } = completion;
		const delta: OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta & {
			reasoning?: string;
			reasoning_content?: string;
			reasoning_text?: string;
		} = choices?.[0]?.delta ?? {};
		const content: string = delta.content ?? "";
		const reasoning: string =
			typeof delta?.reasoning === "string"
				? (delta.reasoning as string)
				: typeof delta?.reasoning_content === "string"
					? (delta.reasoning_content as string)
					: typeof delta?.reasoning_text === "string"
						? (delta.reasoning_text as string)
						: "";
		const last = choices?.[0]?.finish_reason === "stop" || choices?.[0]?.finish_reason === "length";

		// if the last token is a stop and the tool buffer is not empty, yield it as a generated_text
		if (choices?.[0]?.finish_reason === "stop" && toolBuffer.length > 0) {
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
		if (choices?.[0]?.delta?.tool_calls) {
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
		// Whitespace-only deltas still count once a block is open (paragraph
		// breaks are part of the trace); non-blank text is only required to OPEN
		// one, so stray leading whitespace can't produce an empty think block —
		// but it must not be discarded either, hence the buffer.
		if (reasoning.length > 0) {
			if (thinkOpen) {
				combined += reasoning;
			} else if (reasoning.trim().length > 0) {
				combined += "<think>" + pendingReasoningWhitespace + reasoning;
				pendingReasoningWhitespace = "";
				thinkOpen = true;
			} else {
				pendingReasoningWhitespace += reasoning;
			}
		}

		if (content && content.length > 0) {
			const trimmed = content.trim();
			// Allow <think> tags in content to pass through (for models like DeepSeek R1)
			if (thinkOpen && trimmed === "</think>") {
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

	// If metadata wasn't yielded from chunks (e.g., from headers), yield it at the end
	if (!metadataYielded && getRouterMetadata) {
		const routerMetadata = getRouterMetadata();
		// Yield if we have either complete router metadata OR just provider info
		if (
			(routerMetadata && routerMetadata.route && routerMetadata.model) ||
			routerMetadata?.provider
		) {
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
			} as TextGenerationStreamOutput & {
				routerMetadata: { route?: string; model?: string; provider?: string };
			};
		}
	}
}

/**
 * Transform a non-streaming OpenAI chat completion into a stream of TextGenerationStreamOutput
 */
export async function* openAIChatToTextGenerationSingle(
	completion: OpenAI.Chat.Completions.ChatCompletion,
	getRouterMetadata?: () => { route?: string; model?: string; provider?: string }
) {
	const message: NonNullable<OpenAI.Chat.Completions.ChatCompletion.Choice>["message"] & {
		reasoning?: string;
		reasoning_content?: string;
		reasoning_text?: string;
	} = completion.choices?.[0]?.message ?? {};
	let content: string = message?.content || "";
	// Provider-dependent reasoning shapes (non-streaming)
	const r: string =
		typeof message?.reasoning === "string"
			? (message.reasoning as string)
			: typeof message?.reasoning_content === "string"
				? (message.reasoning_content as string)
				: typeof message?.reasoning_text === "string"
					? (message.reasoning_text as string)
					: "";
	// Trim only to TEST for emptiness — whitespace-only reasoning is not a trace
	// and must not become an empty <think> block, but anything real is echoed
	// byte-exact, since vendors documenting preserved thinking can require the
	// payload back unmodified.
	if (r.trim().length > 0) {
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
		...(getRouterMetadata
			? (() => {
					const metadata = getRouterMetadata();
					return (metadata && metadata.route && metadata.model) || metadata?.provider
						? { routerMetadata: metadata }
						: {};
				})()
			: {}),
	} as TextGenerationStreamOutput & {
		routerMetadata?: { route?: string; model?: string; provider?: string };
	};
}
