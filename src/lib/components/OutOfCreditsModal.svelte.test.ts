import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writable } from "svelte/store";
import superjson from "superjson";
import OutOfCreditsModal from "./OutOfCreditsModal.svelte";
import { renderWithApp } from "$lib/components/__tests__/renderWithApp";
import { isPro } from "$lib/stores/isPro";
import { ADD_CREDITS_URL, UPGRADE_PRO_URL } from "$lib/utils/outOfCredits";

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

const settingsContext = (billingOrganization?: string) =>
	new Map<unknown, unknown>([["settings", writable({ billingOrganization })]]);

const render = (
	props: { model?: { id: string; providerOverride?: string } } = {},
	billingOrganization?: string
) =>
	renderWithApp(
		OutOfCreditsModal,
		{ close: vi.fn(), ...props },
		{ context: settingsContext(billingOrganization) }
	);

const dialog = (): HTMLElement => {
	const el = document.querySelector<HTMLElement>('[role="dialog"]');
	if (!el) throw new Error("no dialog rendered");
	return el;
};

const links = () =>
	[...dialog().querySelectorAll("a")].map((a) => [
		a.textContent?.replace(/\s+/g, " ").trim(),
		a.href,
	]);

const estimate = () => document.querySelector("[data-testid=credit-estimate]");

describe("OutOfCreditsModal", () => {
	beforeEach(() => isPro.set(false));
	afterEach(() => {
		isPro.set(null);
		vi.unstubAllGlobals();
	});

	it("tells a free user they have no credits and offers credits before PRO", () => {
		render();

		expect(dialog().textContent).toContain("You're out of credits");
		expect(links()).toEqual([
			["Add credits", ADD_CREDITS_URL],
			["Upgrade to PRO · $2 credits monthly", UPGRADE_PRO_URL],
		]);
	});

	it("offers a PRO user credits only", () => {
		isPro.set(true);
		render();

		expect(links()).toEqual([["Add credits", ADD_CREDITS_URL]]);
	});

	it("blames the billing organization, not the user", () => {
		render({}, "acme");

		expect(dialog().textContent).toContain("acme is out of credits");
		expect(links()[0]).toEqual([
			"Open acme billing",
			"https://huggingface.co/organizations/acme/settings/billing",
		]);
		expect(links()[1][0]).toBe("Change who pays");
	});

	it("shows what $2 buys on the failed model at its provider", async () => {
		const fetch = stubModelDetail();
		render({ model: { id: detail.id } });

		await vi.waitFor(() => expect(estimate()).not.toBeNull());
		expect(String(fetch.mock.calls[0][0])).toContain(`/api/v2/models/${detail.id}`);
		// deepinfra blends to about 1.52 usd per 1M, so 2 usd buys about 1.32M
		expect(estimate()?.textContent).toContain("~1.3M");
		expect(estimate()?.textContent).toContain(detail.displayName);
	});

	it("prices the provider the user picked", async () => {
		stubModelDetail();
		render({ model: { id: detail.id, providerOverride: "novita" } });

		await vi.waitFor(() => expect(estimate()).not.toBeNull());
		expect(estimate()?.textContent).toContain("~650k");
	});

	it("leaves the estimate out when the model detail fails", async () => {
		const fetch = vi.fn(async () => new Response("{}", { status: 500 }));
		vi.stubGlobal("fetch", fetch);
		render({ model: { id: detail.id } });

		await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(estimate()).toBeNull();
		expect(links()[0][0]).toBe("Add credits");
	});
});
