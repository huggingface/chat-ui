import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProcessedModel } from "../models";

const DEEPSEEK = "deepseek-ai/DeepSeek-V4.1-Flash-1017";

vi.mock("$lib/server/config", () => {
	const values: Record<string, unknown> = {
		isHuggingChat: true,
		OPENAI_BASE_URL: "https://router.test/v1",
		OPENAI_API_KEY: "sk-test",
		LLM_ROUTER_ENABLE_TOOLS: "true",
		LLM_ROUTER_TOOLS_MODEL: "deepseek-ai/DeepSeek-V4.1-Flash-1017",
	};
	return { config: new Proxy(values, { get: (target, key) => target[key as string] ?? "" }) };
});
vi.mock("$lib/server/logger", () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("./policy", () => ({ getRoutes: async () => [], resolveRouteModels: () => [] }));
vi.mock("../models", () => ({
	models: [
		{
			id: "deepseek-ai/DeepSeek-V4.1-Flash-1017",
			name: "deepseek-ai/DeepSeek-V4.1-Flash-1017",
			displayName: "DeepSeek",
			parameters: { max_tokens: 49152 },
			defaultProvider: "novita",
			providerMaxTokens: { scaleway: 32768 },
			providers: [{ provider: "novita" }, { provider: "scaleway" }],
			multimodal: false,
		},
	],
}));

const { makeRouterEndpoint } = await import("./endpoint");

const done = () =>
	new Response(
		'data: {"id":"1","object":"chat.completion.chunk","created":0,"model":"m","choices":[{"index":0,"delta":{"content":"hi"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
		{ status: 200, headers: { "content-type": "text/event-stream" } }
	);

function upstream(...statuses: number[]) {
	const fetchMock = vi.fn(async () => {
		const status = statuses.shift() ?? 200;
		return status === 200 ? done() : new Response("{}", { status });
	});
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

const sent = (fetchMock: ReturnType<typeof upstream>) =>
	fetchMock.mock.calls.map((call) => {
		const init = (call as unknown as [string, RequestInit])[1];
		const body = JSON.parse(init.body as string);
		return {
			model: body.model,
			max_tokens: body.max_tokens,
			headers: [...new Headers(init.headers).keys()],
		};
	});

async function runOmniToolsTurn() {
	const endpoint = await makeRouterEndpoint({
		id: "omni",
		name: "omni",
		isRouter: true,
		parameters: {},
	} as unknown as ProcessedModel);
	const gen = await endpoint({
		messages: [{ from: "user", content: "hi" }],
		locals: { mcp: { selectedServerNames: ["hf"] } } as unknown as App.Locals,
	});
	for await (const _ of gen) void _;
}

describe("Omni routing to a model with a default provider", () => {
	afterEach(() => vi.unstubAllGlobals());

	it("pins the default provider and keeps its own max_tokens", async () => {
		const fetchMock = upstream(200);
		await runOmniToolsTurn();
		expect(sent(fetchMock)).toEqual([
			{
				model: `${DEEPSEEK}:novita`,
				max_tokens: 49152,
				headers: expect.not.arrayContaining(["x-chatui-default-provider"]),
			},
		]);
	});

	it("routes around the default provider when it is down, capped for whichever provider auto picks", async () => {
		const fetchMock = upstream(503, 200);
		await runOmniToolsTurn();
		expect(sent(fetchMock).map(({ model, max_tokens }) => ({ model, max_tokens }))).toEqual([
			{ model: `${DEEPSEEK}:novita`, max_tokens: 49152 },
			{ model: DEEPSEEK, max_tokens: 32768 },
		]);
	});
});
