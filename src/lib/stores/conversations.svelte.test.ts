import { describe, expect, it } from "vitest";
import type { ConvSidebar } from "$lib/types/ConvSidebar";
import { CONV_NUM_PER_PAGE } from "$lib/constants/pagination";
import { ConversationsStore } from "./conversations.svelte";

const conv = (id: string): ConvSidebar => ({ id, title: `Chat ${id}`, updatedAt: new Date(0) });
const titles = (store: ConversationsStore) => store.list.map((c) => c.title);

describe("ConversationsStore.append", () => {
	it("keeps older pages in the list so rename and delete apply to them", () => {
		const store = new ConversationsStore();
		store.init([conv("3"), conv("2")]);
		store.append([conv("1"), conv("0")]);

		store.update("0", { title: "Renamed" });
		store.remove("3");

		expect(titles(store)).toEqual(["Chat 2", "Chat 1", "Renamed"]);
	});

	it("loads the row that moves up a page after a delete", () => {
		// Offset-paged like GET /api/v2/conversations: newest first, CONV_NUM_PER_PAGE a page.
		let server = Array.from({ length: 65 }, (_, i) => conv(String(64 - i)));
		const page = (p: number) => server.slice(p * CONV_NUM_PER_PAGE, (p + 1) * CONV_NUM_PER_PAGE);
		const store = new ConversationsStore();
		store.init(page(0));
		store.append(page(store.nextPage));

		server = server.filter((c) => c.id !== "20");
		store.remove("20");
		store.append(page(store.nextPage));
		store.append(page(store.nextPage));

		expect(titles(store)).toEqual(server.map((c) => c.title));
	});

	it("skips conversations that are already listed", () => {
		const store = new ConversationsStore();
		store.init([conv("3"), conv("2")]);
		store.append([conv("2"), conv("1")]);

		expect(titles(store)).toEqual(["Chat 3", "Chat 2", "Chat 1"]);
	});
});
