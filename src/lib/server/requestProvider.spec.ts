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

import { listedDefaultProvider, requestProvider, routedProvider } from "./requestProvider";

const model = {
	id: "zai-org/GLM-5.3-Flash",
	providers: [{ provider: "novita" }, { provider: "baseten" }],
};
const chat = { mlAssistant: false };
const intern = { mlAssistant: true };

const pick = (...args: Parameters<typeof requestProvider>) => requestProvider(...args).provider;

describe("requestProvider", () => {
	it("keeps a listed saved provider", () => {
		expect(requestProvider(model, chat, { [model.id]: "novita" })).toEqual({
			provider: "novita",
			providerIsDefault: false,
		});
	});

	it("drops a saved provider the router no longer lists", () => {
		expect(pick(model, chat, { [model.id]: "together" })).toBeUndefined();
	});

	it("passes routing policies through", () => {
		expect(pick(model, chat, { [model.id]: "fastest" })).toBe("fastest");
	});

	it("keeps the preference when the model has no provider listing", () => {
		expect(pick({ id: model.id }, chat, { [model.id]: "together" })).toBe("together");
	});

	it("drops an unlisted ML Intern pin too", () => {
		mocked.pins.set(model.id, "together");
		expect(pick(model, intern, {})).toBeUndefined();
		mocked.pins.set(model.id, "baseten");
		expect(pick(model, intern, {})).toBe("baseten");
		mocked.pins.clear();
	});

	it("never names a provider for the router alias", () => {
		expect(pick({ ...model, isRouter: true }, chat, { [model.id]: "novita" })).toBeUndefined();
	});

	describe("with a default provider", () => {
		const pinned = { ...model, defaultProvider: "baseten" };

		it("applies when the user has not picked a provider", () => {
			expect(requestProvider(pinned, chat, {})).toEqual({
				provider: "baseten",
				providerIsDefault: true,
			});
			expect(pick(pinned, chat, undefined)).toBe("baseten");
		});

		it("gives way to the user's own pick", () => {
			expect(pick(pinned, chat, { [model.id]: "auto" })).toBe("auto");
			expect(requestProvider(pinned, chat, { [model.id]: "baseten" })).toEqual({
				provider: "baseten",
				providerIsDefault: false,
			});
			expect(pick(pinned, chat, { [model.id]: "novita" })).toBe("novita");
			expect(pick(pinned, chat, { [model.id]: "fastest" })).toBe("fastest");
		});

		it("takes over from a saved provider the router no longer lists", () => {
			expect(requestProvider(pinned, chat, { [model.id]: "scaleway" })).toEqual({
				provider: "baseten",
				providerIsDefault: true,
			});
		});

		it("gives way to the ML Intern pin", () => {
			mocked.pins.set(model.id, "novita");
			expect(requestProvider(pinned, intern, {})).toEqual({
				provider: "novita",
				providerIsDefault: false,
			});
			mocked.pins.clear();
		});

		it("is dropped when the router no longer lists it", () => {
			expect(pick({ ...model, defaultProvider: "together" }, chat, {})).toBeUndefined();
		});
	});
});

describe("routedProvider", () => {
	it("uses the routed model's default provider", () => {
		expect(routedProvider({ ...model, defaultProvider: "novita" })).toEqual({
			provider: "novita",
			providerIsDefault: true,
		});
	});

	it("names no provider when the model has no default", () => {
		expect(routedProvider(model)).toEqual({ provider: undefined, providerIsDefault: false });
	});

	it("drops a default the router no longer lists", () => {
		expect(routedProvider({ ...model, defaultProvider: "together" }).provider).toBeUndefined();
	});

	it("never names a provider for the router alias", () => {
		expect(
			routedProvider({ ...model, isRouter: true, defaultProvider: "novita" }).provider
		).toBeUndefined();
	});
});

describe("listedDefaultProvider", () => {
	it("is the default only while the router lists it", () => {
		expect(listedDefaultProvider({ ...model, defaultProvider: "novita" })).toBe("novita");
		expect(listedDefaultProvider({ ...model, defaultProvider: "together" })).toBeUndefined();
		expect(listedDefaultProvider(model)).toBeUndefined();
	});
});
