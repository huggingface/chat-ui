import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveRouterTarget } from "./textGeneration/mcp/routerResolution";

const { openai } = vi.hoisted(() => ({
	openai: vi.fn(async () => async function* () {}),
}));

vi.mock("$app/environment", () => ({ building: false }));
vi.mock("$env/dynamic/private", () => ({ env: {} }));
vi.mock("$lib/server/config", () => ({
	config: {
		OPENAI_BASE_URL: "https://catalog.test/v1",
		PUBLIC_LLM_ROUTER_ALIAS_ID: "omni",
		LLM_ROUTER_ROUTES_PATH: "/routes.json",
		LLM_ROUTER_ENABLE_MULTIMODAL: "true",
		LLM_ROUTER_MULTIMODAL_MODEL: "omni",
	},
}));
vi.mock("$lib/server/logger", () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("./endpoints/endpoints", async () => {
	const { z } = await import("zod");
	return { default: { openai }, endpointSchema: z.object({ type: z.literal("openai") }) };
});
vi.mock("./router/policy", () => ({ getRoutes: async () => [] }));

afterEach(() => vi.unstubAllGlobals());

describe("router alias collisions", () => {
	it("keeps the visible alias and routes image requests to the backing catalog model", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				Response.json({
					data: [
						{
							id: "omni",
							description: "Vision model",
							architecture: { input_modalities: ["image"] },
						},
						{ id: "omni", description: "Duplicate" },
						{ id: "text" },
					],
				})
			)
		);

		const { models, defaultModel } = await import("./models");
		expect(models.map((model) => model.id)).toEqual(["omni", "text"]);
		expect(defaultModel.isRouter).toBe(true);

		const endpoint = await defaultModel.getEndpoint();
		const stream = await endpoint({
			messages: [
				{
					from: "user",
					content: "Describe this image",
					files: [{ type: "base64", name: "image", value: "", mime: "image/png" }],
				},
			],
			locals: undefined,
		});
		expect((await stream.next()).value).toMatchObject({
			routerMetadata: { model: "omni" },
		});
		expect(openai).toHaveBeenCalledWith(
			expect.objectContaining({
				model: expect.objectContaining({
					id: "omni",
					isRouter: false,
					description: "Vision model",
				}),
			})
		);

		const target = await resolveRouterTarget({
			model: defaultModel,
			hasImageInput: true,
			locals: undefined,
		});
		expect(target).toMatchObject({
			runMcp: true,
			candidateModelId: "omni",
			targetModel: { id: "omni", isRouter: false, description: "Vision model" },
		});
	});
});
