import { describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({ pins: new Map<string, string>() }));
vi.mock("$lib/server/config", () => ({ config: { isHuggingChat: true } }));
vi.mock("$lib/server/logger", () => ({ logger: { warn: vi.fn() } }));
vi.mock("$lib/server/mlAssistant", () => ({
	isMlAssistantConversation: (conv: { mlAssistant?: boolean }) => conv.mlAssistant === true,
}));
vi.mock("$lib/server/mlAssistantModels", () => ({
	mlAssistantProviderFor: (id: string, pref: string | undefined) => mocked.pins.get(id) ?? pref,
}));

import { requestProvider } from "./requestProvider";

const model = {
	id: "zai-org/GLM-5.3-Flash",
	providers: [{ provider: "novita" }, { provider: "baseten" }],
};
const chat = { mlAssistant: false };
const intern = { mlAssistant: true };

describe("requestProvider", () => {
	it("keeps a listed saved provider", () => {
		expect(requestProvider(model, chat, { [model.id]: "novita" })).toBe("novita");
	});

	it("drops a saved provider the router no longer lists", () => {
		expect(requestProvider(model, chat, { [model.id]: "together" })).toBeUndefined();
	});

	it("passes routing policies through", () => {
		expect(requestProvider(model, chat, { [model.id]: "fastest" })).toBe("fastest");
	});

	it("keeps the preference when the model has no provider listing", () => {
		expect(requestProvider({ id: model.id }, chat, { [model.id]: "together" })).toBe("together");
	});

	it("drops an unlisted ML Intern pin too", () => {
		mocked.pins.set(model.id, "together");
		expect(requestProvider(model, intern, {})).toBeUndefined();
		mocked.pins.set(model.id, "baseten");
		expect(requestProvider(model, intern, {})).toBe("baseten");
		mocked.pins.clear();
	});

	it("never names a provider for the router alias", () => {
		expect(
			requestProvider({ ...model, isRouter: true }, chat, { [model.id]: "novita" })
		).toBeUndefined();
	});
});
