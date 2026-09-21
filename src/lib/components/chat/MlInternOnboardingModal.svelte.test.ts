import MlInternOnboardingModal from "./MlInternOnboardingModal.svelte";
import { renderWithApp } from "$lib/components/__tests__/renderWithApp";
import { describe, expect, it, vi } from "vitest";

const dialog = (): HTMLElement => {
	const el = document.querySelector<HTMLElement>('[role="dialog"]');
	if (!el) throw new Error("no dialog rendered");
	return el;
};

const linkTo = (href: string): HTMLAnchorElement => {
	const el = dialog().querySelector<HTMLAnchorElement>(`a[href="${href}"]`);
	if (!el) throw new Error(`no link to ${href}`);
	return el;
};

describe("MlInternOnboardingModal", () => {
	it("names the mode as experimental and covers both account settings", () => {
		renderWithApp(MlInternOnboardingModal, { close: vi.fn() });

		// Source line wraps land in textContent; the copy is asserted as it reads.
		const text = (dialog().textContent ?? "").replace(/\s+/g, " ");
		expect(text).toContain("ML Intern is experimental");
		expect(text).toContain("Enable all MCP tools");
		expect(text).toContain("Cap what ML Intern can spend");
		// A personal account has no spend limit to set on the billing page, so the
		// copy has to name what is actually charged and what actually stops it.
		expect(text).toContain("paid for with your Hugging Face credits");
		expect(text).toContain("your credit balance is the ceiling");
		expect(text).not.toContain("set a budget in your billing settings");
		// Honest about the limit: the chat's cap does not reach everything.
		expect(text).toContain("does not cover anything those Jobs start themselves");
		expect(text).toContain("Chatting with the model does not use the compute budget");
		expect(text).toContain("bill to the organization set in HuggingChat's settings");
	});

	it("is named by its heading for assistive tech", () => {
		renderWithApp(MlInternOnboardingModal, { close: vi.fn() });

		const id = dialog().getAttribute("aria-labelledby");
		expect(id).toBeTruthy();
		expect(document.getElementById(id ?? "")?.textContent).toContain("ML Intern is experimental");
	});

	it("links out to the Hub's MCP and billing settings in a new tab", () => {
		renderWithApp(MlInternOnboardingModal, { close: vi.fn() });

		for (const href of [
			"https://huggingface.co/settings/mcp",
			"https://huggingface.co/settings/billing",
		]) {
			const link = linkTo(href);
			expect(link.getAttribute("target")).toBe("_blank");
			expect(link.getAttribute("rel")).toContain("noopener");
		}
		expect(linkTo("https://huggingface.co/settings/mcp").textContent).toContain(
			"Open MCP settings"
		);
		expect(linkTo("https://huggingface.co/settings/billing").textContent).toContain(
			"Open Hugging Face billing"
		);
	});

	it("closes on the acknowledgement button and on Escape", () => {
		const close = vi.fn();
		renderWithApp(MlInternOnboardingModal, { close });

		const button = [...dialog().querySelectorAll("button")].find((b) =>
			b.textContent?.includes("Got it")
		);
		if (!button) throw new Error("no acknowledgement button");
		button.click();
		expect(close).toHaveBeenCalledTimes(1);

		window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
		expect(close).toHaveBeenCalledTimes(2);
	});
});
