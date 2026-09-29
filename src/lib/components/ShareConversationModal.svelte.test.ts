import { describe, expect, it } from "vitest";
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
