import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ProcessedModel } from "../../models";

const mockConfig = vi.hoisted(() => ({
	LLM_ROUTER_ENABLE_TOOLS: "true",
	LLM_ROUTER_TOOLS_MODEL: "moonshotai/Kimi-K2.6",
	LLM_ROUTER_MULTIMODAL_MODEL: "moonshotai/Kimi-K2.6",
	LLM_ROUTER_FREE_USER_MODEL: "deepseek-ai/DeepSeek-V4-Flash-0731",
	LLM_ROUTER_FALLBACK_MODEL: "",
	LLM_ROUTER_DEFAULT_ROUTE: "",
}));

const mocks = vi.hoisted(() => ({
	resolveUserTier: vi.fn(async (): Promise<"free" | "paid"> => "paid"),
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
	{ id: "free/vl-model", name: "free/vl-model", isRouter: false, multimodal: true },
]);

vi.mock("$lib/server/config", () => ({ config: mockConfig }));
vi.mock("$lib/server/logger", () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../../models", () => ({ models: FIXTURE_MODELS }));
vi.mock("$lib/server/router/policy", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/server/router/policy")>();
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
vi.mock("$lib/server/router/userTier", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/server/router/userTier")>();
	return { ...actual, resolveUserTier: mocks.resolveUserTier };
});

const { resolveRouterTarget } = await import("./routerResolution");

const routerModel = FIXTURE_MODELS[0] as unknown as ProcessedModel;
const kimi = FIXTURE_MODELS[1];
const flash = FIXTURE_MODELS[2];
const freeVl = FIXTURE_MODELS[3];

function makeLocals(withTools = false): App.Locals {
	return {
		sessionId: "session",
		isAdmin: false,
		...(withTools ? { mcp: { selectedServers: [{ name: "hf" }] } } : {}),
	} as unknown as App.Locals;
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.resolveUserTier.mockResolvedValue("paid");
	mockConfig.LLM_ROUTER_FREE_USER_MODEL = "deepseek-ai/DeepSeek-V4-Flash-0731";
});

describe("resolveRouterTarget", () => {
	it("returns non-router models untouched without resolving the tier", async () => {
		const model = kimi as unknown as ProcessedModel;
		const result = await resolveRouterTarget({ model, hasImageInput: false, locals: makeLocals() });
		expect(result).toEqual({ runMcp: true, targetModel: model });
		expect(mocks.resolveUserTier).not.toHaveBeenCalled();
	});

	it("keeps the policy's primary model for paid users on the default route", async () => {
		const result = await resolveRouterTarget({
			model: routerModel,
			hasImageInput: false,
			locals: makeLocals(),
		});
		expect(result.runMcp).toBe(true);
		expect(result.targetModel).toBe(kimi);
		expect(result.resolvedRoute).toBe("default");
	});

	it("pins free users to the free-tier model on the default route", async () => {
		mocks.resolveUserTier.mockResolvedValue("free");
		const result = await resolveRouterTarget({
			model: routerModel,
			hasImageInput: false,
			locals: makeLocals(),
		});
		expect(result.runMcp).toBe(true);
		expect(result.targetModel).toBe(flash);
		expect(result.candidateModelId).toBe("deepseek-ai/DeepSeek-V4-Flash-0731");
		expect(result.resolvedRoute).toBe("default");
	});

	it("routes image input to the multimodal model without resolving the tier", async () => {
		const result = await resolveRouterTarget({
			model: routerModel,
			hasImageInput: true,
			locals: makeLocals(),
		});
		expect(result.runMcp).toBe(true);
		expect(result.targetModel).toBe(kimi);
		expect(result.resolvedRoute).toBe("multimodal");
		expect(mocks.resolveUserTier).not.toHaveBeenCalled();
	});

	it("serves free users' image input with the free model when it is multimodal-capable", async () => {
		mocks.resolveUserTier.mockResolvedValue("free");
		mockConfig.LLM_ROUTER_FREE_USER_MODEL = "free/vl-model";
		const result = await resolveRouterTarget({
			model: routerModel,
			hasImageInput: true,
			locals: makeLocals(),
		});
		expect(result.targetModel).toBe(freeVl);
		expect(result.resolvedRoute).toBe("multimodal");
	});

	it("keeps the regular multimodal model for paid users even with a multimodal free model", async () => {
		mockConfig.LLM_ROUTER_FREE_USER_MODEL = "free/vl-model";
		const result = await resolveRouterTarget({
			model: routerModel,
			hasImageInput: true,
			locals: makeLocals(),
		});
		expect(result.targetModel).toBe(kimi);
		expect(result.resolvedRoute).toBe("multimodal");
	});

	it("pins free users to the free-tier model on the tools route", async () => {
		mocks.resolveUserTier.mockResolvedValue("free");
		const result = await resolveRouterTarget({
			model: routerModel,
			hasImageInput: false,
			locals: makeLocals(true),
		});
		expect(result.targetModel).toBe(flash);
		expect(result.resolvedRoute).toBe("agentic");
	});

	it("keeps the regular tools model for paid users", async () => {
		const result = await resolveRouterTarget({
			model: routerModel,
			hasImageInput: false,
			locals: makeLocals(true),
		});
		expect(result.targetModel).toBe(kimi);
		expect(result.resolvedRoute).toBe("agentic");
	});

	it("skips MCP when the free-tier model is not in the model list", async () => {
		mocks.resolveUserTier.mockResolvedValue("free");
		mockConfig.LLM_ROUTER_FREE_USER_MODEL = "missing/model";
		const result = await resolveRouterTarget({
			model: routerModel,
			hasImageInput: false,
			locals: makeLocals(),
		});
		expect(result.runMcp).toBe(false);
	});
});
