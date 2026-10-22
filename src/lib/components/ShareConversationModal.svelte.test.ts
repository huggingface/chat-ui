import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "@vitest/browser/context";
import { renderWithApp } from "$lib/components/__tests__/renderWithApp";
import ShareConversationModal from "./ShareConversationModal.svelte";

const ID = "66f9a1b2c3d4e5f6a7b8c9d0";

function mount(downloadTrace: boolean, id = ID) {
	renderWithApp(
		ShareConversationModal,
		{ open: true, downloadTrace },
		{ page: { params: { id }, data: { publicConfig: {} } } }
	);
	return document.querySelector<HTMLAnchorElement>("a[download]");
}

describe("ShareConversationModal trace download", () => {
	it("links the conversation's export when asked to", () => {
		const link = mount(true);
		expect(link?.getAttribute("href")).toBe(`/api/v2/conversations/${ID}/export`);
		expect(link?.textContent?.trim()).toBe("Download");
	});

	it("offers nothing outside ML mode", () => {
		expect(mount(false)).toBeNull();
	});

	it("offers nothing on a share snapshot", () => {
		expect(mount(true, "abc1234")).toBeNull();
	});
});

describe("ShareConversationModal copy link", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("says Copied once the link is on the clipboard", async () => {
		const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
		mount(false, "abc1234");

		await page.getByRole("button", { name: "Copy link" }).click();

		await expect.element(page.getByText("Copied")).toBeInTheDocument();
		expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/\/r\/abc1234/));
		expect(document.body.textContent).not.toContain("Couldn't copy the link");
	});

	it("reports a failed clipboard write instead of saying Copied", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(
			new DOMException("Document is not focused.", "NotAllowedError")
		);
		mount(false, "abc1234");

		await page.getByRole("button", { name: "Copy link" }).click();

		await expect.element(page.getByText(/Couldn't copy the link/)).toBeInTheDocument();
		expect(document.body.textContent).not.toContain("Copied");
	});
});
