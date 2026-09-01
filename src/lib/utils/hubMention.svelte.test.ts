import { describe, expect, it, vi } from "vitest";
import { HubMentionState } from "./hubMention.svelte";
import type { HfHubResource } from "./hfHubSearch";

const MODEL: HfHubResource = { id: "distilbert/distilbert-base-uncased", type: "model" };

function makeState(
	results: HfHubResource[] = [MODEL],
	options: { enabled?: boolean; delay?: number } = {}
) {
	const search = vi.fn(async () => {
		if (options.delay) await new Promise((resolve) => setTimeout(resolve, options.delay));
		return results;
	});
	const hub = new HubMentionState({
		enabled: options.enabled ?? true,
		search: search as never,
		debounceMs: 1,
	});
	return { hub, search };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 12));

describe("HubMentionState", () => {
	it("does nothing at all when the deployment is not HuggingChat", async () => {
		// Self-hosted must never send a prefix of the user's prompt to a third party.
		const { hub, search } = makeState([MODEL], { enabled: false });
		hub.update("look at @distilbert", 18);
		await settle();
		expect(search).not.toHaveBeenCalled();
		expect(hub.open).toBe(false);
	});

	it("waits for a query worth searching", async () => {
		const { hub, search } = makeState();
		hub.update("hey @a", 6);
		await settle();
		expect(search).not.toHaveBeenCalled();
		expect(hub.open).toBe(false);

		hub.update("hey @ab", 7);
		await settle();
		expect(search).toHaveBeenCalledTimes(1);
	});

	it("stays closed during the debounce so typing does not flash the panel", async () => {
		const { hub } = makeState();
		hub.update("hey @bert", 9);
		// Before the debounce elapses there is nothing to show yet.
		expect(hub.open).toBe(false);
		await settle();
		expect(hub.status).toBe("success");
	});

	it("keeps only the last query's results when responses land out of order", async () => {
		const slow: HfHubResource = { id: "slow/one", type: "model" };
		const fast: HfHubResource = { id: "fast/two", type: "model" };
		let call = 0;
		const search = vi.fn(async () => {
			call += 1;
			if (call === 1) {
				await new Promise((resolve) => setTimeout(resolve, 40));
				return [slow];
			}
			return [fast];
		});
		const hub = new HubMentionState({
			enabled: true,
			search: search as never,
			debounceMs: 1,
		});

		hub.update("@aa", 3);
		await new Promise((resolve) => setTimeout(resolve, 5));
		hub.update("@bb", 3);
		await new Promise((resolve) => setTimeout(resolve, 60));

		expect(hub.results).toEqual([fast]);
	});

	it("does not accept on Enter until the user has entered the list", async () => {
		// `ping @john` + Enter must send the message, not rewrite the name.
		const { hub } = makeState();
		hub.update("ping @john", 10);
		await settle();
		expect(hub.activeIndex).toBe(-1);
		expect(hub.activeResult).toBeUndefined();

		hub.move(1);
		expect(hub.activeIndex).toBe(0);
		expect(hub.activeResult).toEqual(MODEL);
	});

	it("closes when the tracked mention leaves the value", async () => {
		// ChatWindow clears the draft on submit with a programmatic write, which
		// fires no input event.
		const { hub } = makeState();
		hub.update("compare @bert", 13);
		await settle();
		expect(hub.open).toBe(true);

		hub.syncValue("");
		expect(hub.open).toBe(false);
		expect(hub.mention).toBeNull();
	});

	it("does not re-open for a mention it just completed", async () => {
		const { hub } = makeState();
		hub.update("compare @distilb", 16);
		await settle();

		const replacement = hub.accept("compare @distilb", MODEL);
		expect(replacement?.value).toBe(`compare @${MODEL.id} `);
		expect(hub.open).toBe(false);

		// The caret landing back inside the finished id must not search for it.
		hub.update(replacement?.value ?? "", `compare @${MODEL.id}`.length);
		await settle();
		expect(hub.open).toBe(false);
	});

	it("stays dismissed after Escape until the query changes", async () => {
		const { hub } = makeState();
		hub.update("@bert", 5);
		await settle();
		hub.dismiss();
		expect(hub.open).toBe(false);

		// A click back into the same word does not undo the dismissal.
		hub.update("@bert", 5);
		await settle();
		expect(hub.open).toBe(false);

		// Typing more of it is a new query, so suggestions may return.
		hub.update("@berts", 6);
		await settle();
		expect(hub.open).toBe(true);
	});

	it("reports an error state rather than hanging", async () => {
		const search = vi.fn(async () => {
			throw new Error("network down");
		});
		const hub = new HubMentionState({ enabled: true, search: search as never, debounceMs: 1 });
		vi.spyOn(console, "error").mockImplementation(() => {});

		hub.update("@bert", 5);
		await settle();
		expect(hub.status).toBe("error");
		expect(hub.results).toEqual([]);
	});

	it("drops in-flight work on destroy", async () => {
		const { hub } = makeState([MODEL], { delay: 30 });
		hub.update("@bert", 5);
		hub.destroy();
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(hub.open).toBe(false);
		expect(hub.results).toEqual([]);
	});
});
