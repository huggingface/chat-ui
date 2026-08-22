import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ProcessedModel } from "../models";
import type { EndpointParameters } from "../endpoints/endpoints";

const mockConfig = vi.hoisted(() => ({
	OPENAI_BASE_URL: "https://router.test/v1",
	LLM_ROUTER_ENABLE_MULTIMODAL: "true",
	LLM_ROUTER_MULTIMODAL_MODEL: "moonshotai/Kimi-K2.6",
	LLM_ROUTER_ENABLE_TOOLS: "true",
	LLM_ROUTER_TOOLS_MODEL: "moonshotai/Kimi-K2.6",
	LLM_ROUTER_FREE_USER_MODEL: "deepseek-ai/DeepSeek-V4-Flash-0731",
	LLM_ROUTER_FALLBACK_MODEL: "",
	LLM_ROUTER_DEFAULT_ROUTE: "",
}));

const mocks = vi.hoisted(() => ({
	resolveUserTier: vi.fn(async (): Promise<"free" | "paid"> => "paid"),
	openai: vi.fn(),
	failingModels: new Set<string>(),
}));

const FIXTURE_MODELS = vi.hoisted(() => [
	{ id: "omni", name: "omni", isRouter: true, multimodal: false },
	{ id: "moonshotai/Kimi-K2.6", name: "moonshotai/Kimi-K2.6", isRouter: false, multimodal: true },
	{
		id: "deepseek-ai/DeepSeek-V4-Flash-0731",
		name: "deepseek-ai/DeepSeek-V4-Flash-0731",
		isRouter: false,
		multimodal: false,
	},
]);

vi.mock("$lib/server/config", () => ({ config: mockConfig }));
vi.mock("$lib/server/logger", () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("$lib/server/apiToken", () => ({ getApiToken: () => "sk-test" }));
vi.mock("../endpoints/endpoints", () => ({ default: { openai: mocks.openai } }));
vi.mock("../models", () => ({ models: FIXTURE_MODELS }));
vi.mock("./policy", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./policy")>();
	return {
		...actual,
		getRoutes: async () => [
			{
				name: "default",
				description: "general",
				primary_model: "moonshotai/Kimi-K2.6",
				fallback_models: ["zai-org/GLM-4.6"],
			},
			{ name: "multimodal", description: "vision", primary_model: "moonshotai/Kimi-K2.6" },
			{ name: "agentic", description: "tools", primary_model: "moonshotai/Kimi-K2.6" },
		],
	};
});
vi.mock("./userTier", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./userTier")>();
	return { ...actual, resolveUserTier: mocks.resolveUserTier };
});

const { makeRouterEndpoint } = await import("./endpoint");

const routerModel = FIXTURE_MODELS[0] as unknown as ProcessedModel;

function makeParams(options: { image?: boolean; tools?: boolean } = {}): EndpointParameters {
	return {
		messages: [
			{
				from: "user",
				content: "hello",
				files: options.image
					? [{ type: "hash", value: "x", mime: "image/png", name: "a.png" }]
					: [],
			},
		],
		preprompt: "",
		locals: {
			sessionId: "session",
			isAdmin: false,
			...(options.tools ? { mcp: { selectedServers: [{ name: "hf" }] } } : {}),
		},
	} as unknown as EndpointParameters;
}

interface RouterMetadataEvent {
	routerMetadata?: { route: string; model: string };
}

async function firstMetadata(
	params: EndpointParameters
): Promise<{ route: string; model: string }> {
	const endpoint = await makeRouterEndpoint(routerModel);
	const gen = await endpoint(params);
	const { value } = await gen.next();
	const metadata = (value as RouterMetadataEvent).routerMetadata;
	if (!metadata) throw new Error("first event did not carry router metadata");
	return metadata;
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.failingModels.clear();
	mocks.resolveUserTier.mockResolvedValue("paid");
	mockConfig.LLM_ROUTER_FREE_USER_MODEL = "deepseek-ai/DeepSeek-V4-Flash-0731";
	mocks.openai.mockImplementation((opts: { model: { id?: string; name?: string } }) => {
		const modelId = opts.model.id ?? opts.model.name ?? "";
		return async () => {
			if (mocks.failingModels.has(modelId)) {
				throw Object.assign(new Error(`upstream failure for ${modelId}`), { status: 502 });
			}
			return (async function* () {
				yield {
					token: { id: 1, text: "hi", special: false, logprob: 0 },
					generated_text: "hi",
					details: null,
				};
			})();
		};
	});
});

describe("makeRouterEndpoint", () => {
	it("keeps the policy's primary model for paid users on the default route", async () => {
		await expect(firstMetadata(makeParams())).resolves.toEqual({
			route: "default",
			model: "moonshotai/Kimi-K2.6",
		});
	});

	it("pins free users to the free-tier model on the default route", async () => {
		mocks.resolveUserTier.mockResolvedValue("free");
		await expect(firstMetadata(makeParams())).resolves.toEqual({
			route: "default",
			model: "deepseek-ai/DeepSeek-V4-Flash-0731",
		});
	});

	it("routes image input to the multimodal model without resolving the tier", async () => {
		await expect(firstMetadata(makeParams({ image: true }))).resolves.toEqual({
			route: "multimodal",
			model: "moonshotai/Kimi-K2.6",
		});
		expect(mocks.resolveUserTier).not.toHaveBeenCalled();
	});

	it("pins free users to the free-tier model on the tools route", async () => {
		mocks.resolveUserTier.mockResolvedValue("free");
		await expect(firstMetadata(makeParams({ tools: true }))).resolves.toEqual({
			route: "agentic",
			model: "deepseek-ai/DeepSeek-V4-Flash-0731",
		});
	});

	it("keeps the regular tools model for paid users", async () => {
		await expect(firstMetadata(makeParams({ tools: true }))).resolves.toEqual({
			route: "agentic",
			model: "moonshotai/Kimi-K2.6",
		});
	});

	it("falls back to the route's normal candidates when the free-tier model fails", async () => {
		mocks.resolveUserTier.mockResolvedValue("free");
		mocks.failingModels.add("deepseek-ai/DeepSeek-V4-Flash-0731");
		await expect(firstMetadata(makeParams())).resolves.toEqual({
			route: "default",
			model: "moonshotai/Kimi-K2.6",
		});
	});

	it("falls back to the agentic route's candidates when the free-tier model fails for tools", async () => {
		mocks.resolveUserTier.mockResolvedValue("free");
		mocks.failingModels.add("deepseek-ai/DeepSeek-V4-Flash-0731");
		await expect(firstMetadata(makeParams({ tools: true }))).resolves.toEqual({
			route: "agentic",
			model: "moonshotai/Kimi-K2.6",
		});
	});
});
