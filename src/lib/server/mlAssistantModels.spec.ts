import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({ env: "" as string, mode: true }));
vi.mock("./config", () => ({
	config: new Proxy(
		{},
		{ get: (_t, key) => (key === "ML_ASSISTANT_MODELS" ? mocked.env : undefined) }
	),
}));
vi.mock("$lib/utils/mlAssistantFlag", () => ({
	get ML_ASSISTANT_MODE() {
		return mocked.mode;
	},
}));
vi.mock("./logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import {
	mlAssistantModelEntries,
	mlAssistantModelIds,
	mlAssistantProviderFor,
	parseMlAssistantModels,
	resolveMlAssistantModel,
	setMlAssistantCatalog,
} from "./mlAssistantModels";

const CATALOG = [
	{ id: "zai-org/GLM-5.3-Flash" },
	{ id: "moonshotai/Kimi-K3" },
	{ id: "zai-org/GLM-5.3" },
	{ id: "omni", isRouter: true },
];

describe("parseMlAssistantModels", () => {
	it("keeps entries in order, first is the default", () => {
		const entries = parseMlAssistantModels(
			`[{id:"zai-org/GLM-5.3-Flash", provider:"together"}, {id:"moonshotai/Kimi-K3", provider:"baseten"}]`,
			CATALOG
		);
		expect(entries.map((e) => e.id)).toEqual(["zai-org/GLM-5.3-Flash", "moonshotai/Kimi-K3"]);
		expect(entries[0].provider).toBe("together");
		expect(entries[1].provider).toBe("baseten");
	});

	it("rejects the whole value when an entry has no provider", () => {
		expect(
			parseMlAssistantModels(
				`[{id:"zai-org/GLM-5.3-Flash", provider:"together"}, {id:"moonshotai/Kimi-K3"}]`,
				CATALOG
			)
		).toEqual([]);
	});

	it("drops the router alias even though it is in the catalog", () => {
		expect(
			parseMlAssistantModels(
				`[{id:"omni", provider:"together"}, {id:"zai-org/GLM-5.3", provider:"novita"}]`,
				CATALOG
			).map((e) => e.id)
		).toEqual(["zai-org/GLM-5.3"]);
	});

	it("drops unknown models instead of failing, and dedupes", () => {
		const entries = parseMlAssistantModels(
			`[{id:"nope/missing", provider:"x"}, {id:"moonshotai/Kimi-K3", provider:"together"}, {id:"moonshotai/Kimi-K3", provider:"baseten"}]`,
			CATALOG
		);
		expect(entries).toEqual([{ id: "moonshotai/Kimi-K3", provider: "together" }]);
	});

	it("returns nothing for empty or malformed input", () => {
		expect(parseMlAssistantModels(undefined, CATALOG)).toEqual([]);
		expect(parseMlAssistantModels("   ", CATALOG)).toEqual([]);
		expect(parseMlAssistantModels("not json", CATALOG)).toEqual([]);
		expect(parseMlAssistantModels(`[{provider:"together"}]`, CATALOG)).toEqual([]);
	});

	it("accepts the backtick-wrapped .env convention", () => {
		expect(
			parseMlAssistantModels('`[{id:"moonshotai/Kimi-K3", provider:"together"}]`', CATALOG).map(
				(e) => e.id
			)
		).toEqual(["moonshotai/Kimi-K3"]);
	});

	it("accepts any id when no catalog is given", () => {
		expect(parseMlAssistantModels(`[{id:"anything", provider:"p"}]`).map((e) => e.id)).toEqual([
			"anything",
		]);
	});
});

describe("configured set", () => {
	beforeEach(() => {
		mocked.mode = true;
		mocked.env = `[
			{id:"zai-org/GLM-5.3-Flash", provider:"together", parameters:{max_tokens: 49152}},
			{id:"moonshotai/Kimi-K3", provider:"fireworks-ai"},
		]`;
		setMlAssistantCatalog(() => CATALOG);
	});

	it("exposes ids in configured order", () => {
		expect(mlAssistantModelIds()).toEqual(["zai-org/GLM-5.3-Flash", "moonshotai/Kimi-K3"]);
		expect(mlAssistantModelEntries()[0].parameters).toEqual({ max_tokens: 49152 });
	});

	it("resolves a requested model to itself when listed, else to the default", () => {
		expect(resolveMlAssistantModel("moonshotai/Kimi-K3")).toBe("moonshotai/Kimi-K3");
		expect(resolveMlAssistantModel("omni")).toBe("zai-org/GLM-5.3-Flash");
		expect(resolveMlAssistantModel(undefined)).toBe("zai-org/GLM-5.3-Flash");
	});

	it("pins the provider over the user's preference for listed models only", () => {
		expect(mlAssistantProviderFor("zai-org/GLM-5.3-Flash", "baseten")).toBe("together");
		expect(mlAssistantProviderFor("zai-org/GLM-5.3-Flash", "auto")).toBe("together");
		expect(mlAssistantProviderFor("zai-org/GLM-5.3", "baseten")).toBe("baseten");
		expect(mlAssistantProviderFor("zai-org/GLM-5.3", undefined)).toBeUndefined();
	});

	it("re-parses when the env value changes", () => {
		expect(mlAssistantModelIds()).toHaveLength(2);
		mocked.env = `[{id:"zai-org/GLM-5.3", provider:"novita"}]`;
		expect(mlAssistantModelIds()).toEqual(["zai-org/GLM-5.3"]);
	});

	it("is empty when the build does not ship the mode", () => {
		mocked.mode = false;
		setMlAssistantCatalog(() => CATALOG);
		expect(mlAssistantModelIds()).toEqual([]);
		expect(resolveMlAssistantModel("zai-org/GLM-5.3-Flash")).toBeUndefined();
	});
});
