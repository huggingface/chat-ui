import { describe, expect, it } from "vitest";
import type { ConvSidebar } from "$lib/types/ConvSidebar";
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

	it("skips conversations that are already listed", () => {
		const store = new ConversationsStore();
		store.init([conv("3"), conv("2")]);
		store.append([conv("2"), conv("1")]);

		expect(titles(store)).toEqual(["Chat 3", "Chat 2", "Chat 1"]);
	});
});
