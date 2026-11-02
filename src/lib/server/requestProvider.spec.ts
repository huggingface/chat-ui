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

import { requestProvider, routedProvider } from "./requestProvider";

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

	describe("with a default provider", () => {
		const pinned = { ...model, defaultProvider: "baseten" };

		it("applies when the user has not picked a provider", () => {
			expect(requestProvider(pinned, chat, {})).toBe("baseten");
			expect(requestProvider(pinned, chat, undefined)).toBe("baseten");
		});

		it("gives way to the user's own pick", () => {
			expect(requestProvider(pinned, chat, { [model.id]: "auto" })).toBe("auto");
			expect(requestProvider(pinned, chat, { [model.id]: "novita" })).toBe("novita");
			expect(requestProvider(pinned, chat, { [model.id]: "fastest" })).toBe("fastest");
		});

		it("gives way to the ML Intern pin", () => {
			mocked.pins.set(model.id, "novita");
			expect(requestProvider(pinned, intern, {})).toBe("novita");
			mocked.pins.clear();
		});

		it("is dropped when the router no longer lists it", () => {
			expect(requestProvider({ ...model, defaultProvider: "together" }, chat, {})).toBeUndefined();
		});
	});
});

describe("routedProvider", () => {
	it("uses the routed model's default provider", () => {
		expect(routedProvider({ ...model, defaultProvider: "novita" })).toBe("novita");
	});

	it("names no provider when the model has no default", () => {
		expect(routedProvider(model)).toBeUndefined();
	});

	it("drops a default the router no longer lists", () => {
		expect(routedProvider({ ...model, defaultProvider: "together" })).toBeUndefined();
	});

	it("never names a provider for the router alias", () => {
		expect(routedProvider({ ...model, isRouter: true, defaultProvider: "novita" })).toBeUndefined();
	});
});
