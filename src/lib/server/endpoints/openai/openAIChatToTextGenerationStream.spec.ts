import { describe, expect, it } from "vitest";
import type OpenAI from "openai";
import type { Stream } from "openai/streaming";
import { openAIChatToTextGenerationStream } from "./openAIChatToTextGenerationStream";

type Chunk = OpenAI.Chat.Completions.ChatCompletionChunk;

function mockStream(chunks: unknown[]): Stream<Chunk> {
	async function* gen() {
		for (const c of chunks) yield c as Chunk;
	}
	return gen() as unknown as Stream<Chunk>;
}

type Output = { token: { special: boolean }; generated_text: string | null; truncated?: boolean };

async function collect(stream: AsyncIterable<unknown>): Promise<Output[]> {
	const out: Output[] = [];
	for await (const o of stream) out.push(o as Output);
	return out;
}

describe("openAIChatToTextGenerationStream truncation handling", () => {
	it("flags truncated=true when the stream ends with finish_reason 'length'", async () => {
		// Mimics a reasoning model (e.g. GLM-5.2) that spends its entire max_tokens budget on
		// reasoning_content and hits the limit before ever emitting a final answer.
		const chunks = [
			{ choices: [{ index: 0, delta: { reasoning_content: "let me think about the kebab" } }] },
			{ choices: [{ index: 0, delta: { reasoning_content: " a bit more, drafting code" } }] },
			{ choices: [{ index: 0, delta: {}, finish_reason: "length" }] },
		];

		const outputs = await collect(openAIChatToTextGenerationStream(mockStream(chunks)));
		const final = outputs.find((o) => o.generated_text !== null);

		expect(final).toBeDefined();
		expect(final?.truncated).toBe(true);
		// The reasoning is still surfaced as an (unterminated) <think> block.
		expect(final?.generated_text).toContain("<think>");
	});

	it("does not flag truncated on a normal finish_reason 'stop'", async () => {
		const chunks = [
			{ choices: [{ index: 0, delta: { content: "Hello" } }] },
			{ choices: [{ index: 0, delta: { content: " world" }, finish_reason: "stop" }] },
		];

		const outputs = await collect(openAIChatToTextGenerationStream(mockStream(chunks)));
		const final = outputs.find((o) => o.generated_text !== null);

		expect(final?.generated_text).toBe("Hello world");
		expect(final?.truncated).toBeFalsy();
	});
});
