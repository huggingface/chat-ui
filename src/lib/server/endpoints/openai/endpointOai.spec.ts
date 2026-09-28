import { afterEach, describe, expect, it, vi } from "vitest";
import { endpointOai } from "./endpointOai";
import type { EndpointMessage } from "../endpoints";

vi.mock("$lib/server/config", () => ({
	config: { OPENAI_API_KEY: "sk-test", PUBLIC_APP_NAME: "test" },
}));
vi.mock("$lib/server/billing", () => ({ inferenceBillingHeaders: () => ({}) }));

afterEach(() => vi.unstubAllGlobals());

const model = {
	id: "test-model",
	name: "test-model",
	parameters: {},
	multimodal: false,
	preservesReasoning: false,
};

const messages: EndpointMessage[] = [{ from: "user", content: "hi" }] as EndpointMessage[];

const sse = (chunks: object[]) =>
	chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n";

const chunk = (content: string, finish_reason: string | null = null) => ({
	id: "c",
	object: "chat.completion.chunk",
	created: 0,
	model: "test-model",
	choices: [{ index: 0, delta: { content }, finish_reason }],
});

/**
 * A streaming response whose headers resolve immediately but whose body only
 * completes once `release` is called, so two in-flight requests can be
 * interleaved deterministically.
 */
function gatedResponse(provider: string, text: string) {
	let release!: () => void;
	const released = new Promise<void>((resolve) => (release = resolve));
	const encoder = new TextEncoder();
	const body = new ReadableStream<Uint8Array>({
		async start(controller) {
			controller.enqueue(encoder.encode(sse([chunk(text)])));
			await released;
			controller.enqueue(encoder.encode(sse([chunk("", "stop")])));
			controller.close();
		},
	});
	const response = new Response(body, {
		status: 200,
		headers: { "content-type": "text/event-stream", "x-inference-provider": provider },
	});
	return { response, release };
}

async function providerOf(stream: AsyncIterable<{ routerMetadata?: { provider?: string } }>) {
	let provider: string | undefined;
	for await (const output of stream) {
		if (output.routerMetadata?.provider) provider = output.routerMetadata.provider;
	}
	return provider;
}

describe("endpointOai router metadata", () => {
	it("reports each request's own provider when requests overlap", async () => {
		const alpha = gatedResponse("alpha", "A");
		const beta = gatedResponse("beta", "B");
		const responses = [alpha.response, beta.response];
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => responses.shift())
		);

		const endpoint = await endpointOai({ type: "openai", model, baseURL: "http://llm.test/v1" });

		// Both responses' headers arrive before either body finishes; the
		// second one finishes first.
		const first = providerOf(await endpoint({ messages, locals: undefined }));
		const second = providerOf(await endpoint({ messages, locals: undefined }));
		beta.release();
		expect(await second).toBe("beta");
		alpha.release();
		expect(await first).toBe("alpha");
	});

	it("does not replay a previous response's provider on one that has none", async () => {
		const withProvider = gatedResponse("alpha", "A");
		const encoder = new TextEncoder();
		const withoutProvider = new Response(
			new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(encoder.encode(sse([chunk("B"), chunk("", "stop")])));
					controller.close();
				},
			}),
			{ status: 200, headers: { "content-type": "text/event-stream" } }
		);
		const responses = [withProvider.response, withoutProvider];
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => responses.shift())
		);

		const endpoint = await endpointOai({ type: "openai", model, baseURL: "http://llm.test/v1" });

		withProvider.release();
		expect(await providerOf(await endpoint({ messages, locals: undefined }))).toBe("alpha");
		expect(await providerOf(await endpoint({ messages, locals: undefined }))).toBeUndefined();
	});
});
