import { describe, expect, it } from "vitest";
import type OpenAI from "openai";
import type { Stream } from "openai/streaming";
import {
	openAIChatToTextGenerationSingle,
	openAIChatToTextGenerationStream,
} from "./openAIChatToTextGenerationStream";
import { unescapeThinkTags } from "$lib/utils/escapeThinkTags";
import { servingProvider } from "./servingProvider";

type Delta = {
	content?: string;
	reasoning?: string;
	reasoning_content?: string;
	reasoning_text?: string;
};

/** Minimal stand-in for the SDK's Stream — the adapter only iterates it. */
function streamOf(deltas: Delta[]): Stream<OpenAI.Chat.Completions.ChatCompletionChunk> {
	return (async function* () {
		for (const delta of deltas) {
			yield { choices: [{ index: 0, delta, finish_reason: null }] };
		}
		yield { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] };
	})() as unknown as Stream<OpenAI.Chat.Completions.ChatCompletionChunk>;
}

/** Everything the adapter emitted, concatenated — what lands in message.content. */
async function textFrom(deltas: Delta[]): Promise<string> {
	let out = "";
	for await (const output of openAIChatToTextGenerationStream(streamOf(deltas))) {
		if (!output.token.special) out += output.token.text;
	}
	return out;
}

describe("openAIChatToTextGenerationStream reasoning", () => {
	it("wraps reasoning deltas in a single think block", async () => {
		expect(
			await textFrom([
				{ reasoning: "step one " },
				{ reasoning: "step two" },
				{ content: "Answer." },
			])
		).toBe("<think>step one step two</think>Answer.");
	});

	it("does not open a think block for whitespace-only reasoning", async () => {
		// A provider that emits a blank reasoning chunk before any real thinking
		// would otherwise leave an empty <think> in the persisted content, which
		// the UI renders as a stray thinking widget.
		const text = await textFrom([{ reasoning: "  \n" }, { content: "Answer." }]);
		expect(text).not.toContain("<think>");
		expect(text).toBe("Answer.");
	});

	it("keeps leading whitespace byte-exact once real reasoning arrives", async () => {
		// Buffered rather than discarded: vendors documenting preserved thinking
		// can require the reasoning echoed back unmodified, so the bytes have to
		// survive even though they cannot open the block on their own.
		expect(
			await textFrom([{ reasoning: "\n\n" }, { reasoning: "thought" }, { content: "A." }])
		).toBe("<think>\n\nthought</think>A.");
	});

	it("keeps whitespace inside an already-open block", async () => {
		expect(
			await textFrom([{ reasoning: "one" }, { reasoning: "\n\n" }, { reasoning: "two" }])
		).toContain("<think>one\n\ntwo");
	});

	it("accepts reasoning_content and reasoning_text as reasoning", async () => {
		expect(await textFrom([{ reasoning_content: "rc" }, { content: "A." }])).toBe(
			"<think>rc</think>A."
		);
		expect(await textFrom([{ reasoning_text: "rt" }, { content: "A." }])).toBe(
			"<think>rt</think>A."
		);
	});
});

describe("openAIChatToTextGenerationSingle reasoning", () => {
	async function contentFrom(message: Record<string, unknown>): Promise<string | null | undefined> {
		const completion = { choices: [{ index: 0, message, finish_reason: "stop" }] };
		for await (const output of openAIChatToTextGenerationSingle(
			completion as unknown as OpenAI.Chat.Completions.ChatCompletion
		)) {
			if (output.generated_text != null) return output.generated_text;
		}
	}

	it("wraps reasoning in a think block", async () => {
		expect(await contentFrom({ content: "Answer.", reasoning: "thought" })).toBe(
			"<think>thought</think>Answer."
		);
	});

	it("does not emit an empty think block for whitespace-only reasoning", async () => {
		// Same rule as the streaming path above, so both produce the same stored
		// shape for the same upstream response.
		expect(await contentFrom({ content: "Answer.", reasoning: "  \n " })).toBe("Answer.");
	});
});

describe("openAIChatToTextGenerationStream literal think tags in reasoning", () => {
	it("keeps a literal tag split across reasoning deltas inside the block", async () => {
		const text = await textFrom([
			{ reasoning_content: "Qwen3 soft-switch: empty <thi" },
			{ reasoning_content: "nk></think> disables thinking. <" },
			{ content: "Answer." },
		]);
		expect(text.match(/<\/?think>/g)).toEqual(["<think>", "</think>"]);
		expect(text.endsWith("</think>Answer.")).toBe(true);
		expect(unescapeThinkTags(text)).toBe(
			"<think>Qwen3 soft-switch: empty <think></think> disables thinking. <</think>Answer."
		);
	});

	it("escapes literal tags in non-streaming reasoning", async () => {
		const completion = {
			choices: [{ message: { content: "A.", reasoning_content: "use <think></think>" } }],
		} as unknown as OpenAI.Chat.Completions.ChatCompletion;
		let text = "";
		for await (const output of openAIChatToTextGenerationSingle(completion)) {
			text += output.token.text;
		}
		expect(text.match(/<\/?think>/g)).toEqual(["<think>", "</think>"]);
	});
});

describe("router metadata of calls the HF router sends through OpenRouter", () => {
	const model = {
		providers: [
			{ provider: "deepinfra", provider_name: "DeepInfra" },
			{ provider: "fireworks-ai", provider_name: "Fireworks" },
		],
	};
	/** what endpointOai passes: the x-inference-provider header, resolved with what the chunks name */
	const metadataFor = (header: string) => (servedBy?: string) => ({
		provider: servingProvider(model, header, servedBy),
	});

	/** OpenRouter names the provider serving the call on every chunk */
	function openRouterStream(servedBy: string): Stream<OpenAI.Chat.Completions.ChatCompletionChunk> {
		return (async function* () {
			yield { provider: servedBy, choices: [{ index: 0, delta: { content: "Hi" } }] };
			yield { provider: servedBy, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] };
		})() as unknown as Stream<OpenAI.Chat.Completions.ChatCompletionChunk>;
	}

	async function streamedProvider(header: string, servedBy: string) {
		let provider: string | undefined;
		for await (const output of openAIChatToTextGenerationStream(
			openRouterStream(servedBy),
			metadataFor(header)
		)) {
			if ("routerMetadata" in output) {
				provider = (output.routerMetadata as { provider?: string }).provider;
			}
		}
		return provider;
	}

	it("names the provider that served the call rather than openrouter", async () => {
		expect(await streamedProvider("openrouter", "DeepInfra")).toBe("deepinfra");
		expect(await streamedProvider("openrouter", "Fireworks")).toBe("fireworks-ai");
	});

	it("keeps OpenRouter's name of a provider the model doesn't list", async () => {
		expect(await streamedProvider("openrouter", "Groq")).toBe("Groq");
	});

	it("keeps the header of a call the router made directly", async () => {
		expect(await streamedProvider("together", "DeepInfra")).toBe("together");
	});

	it("names the provider of a non-streaming completion", async () => {
		const completion = {
			provider: "DeepInfra",
			choices: [{ message: { content: "Hi" } }],
		} as unknown as OpenAI.Chat.Completions.ChatCompletion;
		const [output] = await Array.fromAsync(
			openAIChatToTextGenerationSingle(completion, metadataFor("openrouter"))
		);
		expect(output.routerMetadata).toEqual({ provider: "deepinfra" });
	});
});
