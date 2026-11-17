import AddServerForm from "./AddServerForm.svelte";
import { render } from "vitest-browser-svelte";
import { page } from "@vitest/browser/context";
import { describe, expect, it, vi } from "vitest";

function renderForm() {
	render(AddServerForm, {
		onsubmit: vi.fn(),
		oncancel: vi.fn(),
		initialHeaders: [
			{ key: "X-Client", value: "desktop" },
			{ key: "Authorization", value: "Bearer token" },
			{ key: "X-API-Key", value: "secret" },
		],
	});
	return page.getByPlaceholder("Value");
}

describe("AddServerForm", () => {
	// The show/hide flags are per row: removing a row must not hand a shown flag to the row below.
	it("keeps each header's show/hide state when a header above it is removed", async () => {
		const values = renderForm();
		await page.getByText("HTTP Headers (Optional)").click();

		await page.getByTitle("Show value").first().click();
		await expect.element(values.nth(1)).toHaveAttribute("type", "text");
		await expect.element(values.nth(2)).toHaveAttribute("type", "password");

		await page.getByTitle("Remove header").first().click();

		await expect.element(values.nth(0)).toHaveValue("Bearer token");
		await expect.element(values.nth(0)).toHaveAttribute("type", "text");
		await expect.element(values.nth(1)).toHaveValue("secret");
		await expect.element(values.nth(1)).toHaveAttribute("type", "password");
	});

	it("hides the remaining value when the shown header itself is removed", async () => {
		const values = renderForm();
		await page.getByText("HTTP Headers (Optional)").click();

		await page.getByTitle("Show value").first().click();
		await page.getByTitle("Remove header").nth(1).click();

		await expect.element(values.nth(1)).toHaveValue("secret");
		await expect.element(values.nth(1)).toHaveAttribute("type", "password");
	});
});
