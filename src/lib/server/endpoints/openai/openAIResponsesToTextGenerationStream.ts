import type { TextGenerationStreamOutput } from "@huggingface/inference";
import type OpenAI from "openai";
import type { Stream } from "openai/streaming";
import type {
	ResponseStreamEvent,
	ResponseTextDeltaEvent,
	ResponseCompletedEvent,
	ResponseReasoningDeltaEvent,
} from "openai/resources/responses/responses";

type RouterMetadataGetter = () => { route?: string; model?: string; provider?: string };

/**
 * Transform a stream of OpenAI Responses API events into TextGenerationStreamOutput.
 *
 * This is the Responses API equivalent of openAIChatToTextGenerationStream.
 */
export async function* openAIResponsesToTextGenerationStream(
	eventStream: Stream<ResponseStreamEvent>,
	getRouterMetadata?: RouterMetadataGetter
) {
	let generatedText = "";
	let tokenId = 0;
	let metadataYielded = false;
	let thinkOpen = false;

	for await (const event of eventStream) {
		// Check for router metadata on the raw event (custom extension from HF router)
		const retyped = event as {
			"x-router-metadata"?: { route: string; model: string; provider?: string };
		};
		if (!metadataYielded && retyped["x-router-metadata"]) {
			const metadata = retyped["x-router-metadata"];
			yield {
				token: { id: tokenId++, text: "", logprob: 0, special: true },
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
		}

		switch (event.type) {
			// --- Reasoning tokens ---
			case "response.reasoning.delta": {
				const re = event as ResponseReasoningDeltaEvent;
				// delta is typed as `unknown`; it's a string when present
				const text = typeof re.delta === "string" ? re.delta : "";
				if (text) {
					let combined = "";
					if (!thinkOpen) {
						combined = "<think>" + text;
						thinkOpen = true;
					} else {
						combined = text;
					}
					generatedText += combined;
					yield {
						token: { id: tokenId++, text: combined, logprob: 0, special: false },
						generated_text: null,
						details: null,
					} as TextGenerationStreamOutput;
				}
				break;
			}

			case "response.reasoning.done": {
				// Close reasoning block if open
				if (thinkOpen) {
					const closeTag = "</think>";
					generatedText += closeTag;
					yield {
						token: { id: tokenId++, text: closeTag, logprob: 0, special: false },
						generated_text: null,
						details: null,
					} as TextGenerationStreamOutput;
					thinkOpen = false;
				}
				break;
			}

			// --- Text content tokens ---
			case "response.output_text.delta": {
				const te = event as ResponseTextDeltaEvent;
				let text = te.delta;

				// Close thinking if we get text content while think is still open
				if (thinkOpen && text) {
					text = "</think>" + text;
					thinkOpen = false;
				}

				generatedText += text;
				yield {
					token: { id: tokenId++, text, logprob: 0, special: false },
					generated_text: null,
					details: null,
				} as TextGenerationStreamOutput;
				break;
			}

			case "response.output_text.done": {
				// Text part is done; the full generated text will be emitted at response.completed
				break;
			}

			// --- Function call arguments (tool calls) ---
			case "response.function_call_arguments.done": {
				// We don't emit tool calls as text content.
				// The MCP / tool flow in chat-ui handles this separately.
				break;
			}

			// --- Response completed ---
			case "response.completed": {
				const ce = event as ResponseCompletedEvent;
				const status = ce.response?.status;
				const isComplete = status === "completed";

				yield {
					token: { id: tokenId++, text: "", logprob: 0, special: true },
					generated_text: isComplete ? generatedText : null,
					details: null,
				} as TextGenerationStreamOutput;
				break;
			}

			// --- Error / failure ---
			case "response.failed": {
				// Close reasoning if open
				if (thinkOpen) {
					generatedText += "</think>";
					thinkOpen = false;
				}
				yield {
					token: { id: tokenId++, text: "", logprob: 0, special: true },
					generated_text: generatedText || null,
					details: null,
				} as TextGenerationStreamOutput;
				break;
			}

			default:
				// Ignore other event types (response.created, response.in_progress, etc.)
				break;
		}
	}

	// If metadata wasn't yielded from chunks, yield it from headers at the end
	if (!metadataYielded && getRouterMetadata) {
		const routerMetadata = getRouterMetadata();
		if (
			(routerMetadata && routerMetadata.route && routerMetadata.model) ||
			routerMetadata?.provider
		) {
			yield {
				token: { id: tokenId++, text: "", logprob: 0, special: true },
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
 * Transform a non-streaming OpenAI Responses API result into TextGenerationStreamOutput.
 */
export async function* openAIResponsesToTextGenerationSingle(
	response: OpenAI.Responses.Response,
	getRouterMetadata?: RouterMetadataGetter
) {
	let content = "";

	// Extract text from output items
	for (const item of response.output ?? []) {
		if (item.type === "message") {
			for (const part of item.content ?? []) {
				if (part.type === "output_text") {
					content += part.text;
				}
			}
		}
		// Handle reasoning items by wrapping in <think> tags
		if (item.type === "reasoning") {
			const reasoning = item as { type: "reasoning"; summary?: Array<{ text?: string }> };
			const summaryTexts = (reasoning.summary ?? [])
				.map((s) => s.text ?? "")
				.filter(Boolean)
				.join("");
			if (summaryTexts) {
				content = `<think>${summaryTexts}</think>` + content;
			}
		}
	}

	yield {
		token: { id: 0, text: content, logprob: 0, special: false },
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
