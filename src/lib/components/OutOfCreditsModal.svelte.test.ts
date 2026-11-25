import { afterEach, describe, expect, it, vi } from "vitest";
import { writable } from "svelte/store";
import OutOfCreditsModal from "./OutOfCreditsModal.svelte";
import { renderWithApp } from "$lib/components/__tests__/renderWithApp";
import { isPro } from "$lib/stores/isPro";
import { ADD_CREDITS_URL, UPGRADE_PRO_URL } from "$lib/utils/outOfCredits";

const settingsContext = (billingOrganization?: string) =>
	new Map<unknown, unknown>([["settings", writable({ billingOrganization })]]);

const dialog = (): HTMLElement => {
	const el = document.querySelector<HTMLElement>('[role="dialog"]');
	if (!el) throw new Error("no dialog rendered");
	return el;
};

const links = () => [...dialog().querySelectorAll("a")].map((a) => [a.textContent?.trim(), a.href]);

describe("OutOfCreditsModal", () => {
	afterEach(() => isPro.set(null));

	it("tells a free user they have no credits and offers credits before PRO", () => {
		isPro.set(false);
		renderWithApp(OutOfCreditsModal, { close: vi.fn() }, { context: settingsContext() });

		expect(dialog().textContent).toContain("You're out of credits");
		expect(links()).toEqual([
			["Add credits", ADD_CREDITS_URL],
			["Upgrade to PRO", UPGRADE_PRO_URL],
		]);
	});

	it("offers a PRO user credits only", () => {
		isPro.set(true);
		renderWithApp(OutOfCreditsModal, { close: vi.fn() }, { context: settingsContext() });

		expect(links()).toEqual([["Add credits", ADD_CREDITS_URL]]);
	});

	it("blames the billing organization, not the user", () => {
		isPro.set(false);
		renderWithApp(OutOfCreditsModal, { close: vi.fn() }, { context: settingsContext("acme") });

		expect(dialog().textContent).toContain("acme is out of credits");
		expect(links()[0]).toEqual([
			"Open acme billing",
			"https://huggingface.co/organizations/acme/settings/billing",
		]);
		expect(links()[1][0]).toBe("Change who pays");
	});
});
