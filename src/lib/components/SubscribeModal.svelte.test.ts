import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import superjson from "superjson";
import { renderWithApp } from "$lib/components/__tests__/renderWithApp";
import { isPro } from "$lib/stores/isPro";
import SubscribeModal from "./SubscribeModal.svelte";

const detail = {
	id: "deepseek-ai/DeepSeek-V4-Pro",
	displayName: "deepseek-ai/DeepSeek-V4-Pro",
	defaultProvider: "deepinfra",
	providers: [
		{ provider: "deepinfra", status: "live", pricing: { input: 1.3, output: 2.6 } },
		{ provider: "novita", status: "live", pricing: { input: 2.6, output: 5.2 } },
	],
};

function stubModelDetail() {
	const fetch = vi.fn(
		async (_input: RequestInfo | URL) => new Response(superjson.stringify(detail), { status: 200 })
	);
	vi.stubGlobal("fetch", fetch);
	return fetch;
}

const estimate = () => document.querySelector("[data-testid=credit-estimate]");
const links = () =>
	[...document.querySelectorAll<HTMLAnchorElement>("a")].map((a) => a.textContent?.trim());

describe("SubscribeModal", () => {
	beforeEach(() => isPro.set(false));
	afterEach(() => vi.unstubAllGlobals());

	it("leads with credits and offers PRO to free accounts", () => {
		stubModelDetail();
		renderWithApp(SubscribeModal, { close: () => {} });
		expect(document.body.textContent).toContain("Out of credits");
		expect(links()[0]).toBe("Add credits");
		expect(links()[1]).toContain("Upgrade to PRO");
	});

	it("does not offer PRO to PRO accounts", () => {
		isPro.set(true);
		stubModelDetail();
		renderWithApp(SubscribeModal, { close: () => {} });
		expect(links()).toEqual(["Add credits"]);
	});

	it("shows what $2 buys on the failed model at its provider", async () => {
		const fetch = stubModelDetail();
		renderWithApp(SubscribeModal, {
			close: () => {},
			model: { id: detail.id },
		});
		await vi.waitFor(() => expect(estimate()).not.toBeNull());
		expect(String(fetch.mock.calls[0][0])).toContain(`/api/v2/models/${detail.id}`);
		// deepinfra blended: (5 * 1.3 + 2.6) / 6 per 1M, so $2 buys ~1.32M
		expect(estimate()?.textContent).toContain("$2");
		expect(estimate()?.textContent).toContain("~1.3M");
		expect(estimate()?.textContent).toContain(detail.displayName);
	});

	it("prices the provider the user picked", async () => {
		stubModelDetail();
		renderWithApp(SubscribeModal, {
			close: () => {},
			model: { id: detail.id, providerOverride: "novita" },
		});
		await vi.waitFor(() => expect(estimate()).not.toBeNull());
		expect(estimate()?.textContent).toContain("~650k");
	});

	it("leaves the estimate out when the model detail fails", async () => {
		const fetch = vi.fn(async () => new Response("{}", { status: 500 }));
		vi.stubGlobal("fetch", fetch);
		renderWithApp(SubscribeModal, { close: () => {}, model: { id: detail.id } });
		await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(estimate()).toBeNull();
		expect(links()[0]).toBe("Add credits");
	});
});
