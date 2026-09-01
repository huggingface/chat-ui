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

		const text = dialog().textContent ?? "";
		expect(text).toContain("ML Intern is experimental");
		expect(text).toContain("Enable all MCP tools");
		expect(text).toContain("Set a spending cap");
		// Honest about the limit: enforced in the chat, but not a hard guarantee.
		expect(text).toContain("strictly enforced");
		expect(text).toContain("not a guarantee");
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
			"Open billing settings"
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
