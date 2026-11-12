import SpacePane from "./SpacePane.svelte";
import { render } from "vitest-browser-svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import { sidePane, type SidePaneSpace } from "$lib/stores/sidePane.svelte";

// no such space, the hub 404 page never answers get
const ORIGIN = "https://chat-ui-test-no-such-space-0.hf.space";
const SPACE: SidePaneSpace = {
	url: ORIGIN,
	label: "chat-ui-test/no-such-space-0",
	spaceId: "chat-ui-test/no-such-space-0",
	private: false,
	checkId: "check-1",
};
const items = [{ kind: "space" as const, ...SPACE }];
const CONV = "6ad03a4c353929f19edc560f";

type Post = Record<string, unknown>;
let posts: Post[];
let postUrls: string[];
let gets: string[];
/** holds the response to the next loading post until released */
let holdLoading: Promise<void> | undefined;

beforeEach(() => {
	posts = [];
	postUrls = [];
	gets = [];
	holdLoading = undefined;
	vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
		const url = String(input);
		if (init?.method === "POST") {
			const body = JSON.parse(String(init.body));
			posts.push(body);
			postUrls.push(url);
			if (body.state === "loading" && holdLoading) await holdLoading;
			return Response.json({ stored: 0 });
		}
		gets.push(url);
		return Response.json({ sign: "jwt-123" });
	});
});

afterEach(() => {
	sidePane.reset();
	vi.restoreAllMocks();
});

const frameOf = (root: ParentNode) => root.querySelector("iframe") as HTMLIFrameElement;
const stateOf = (root: ParentNode) =>
	root.querySelector("[data-console-state]")?.getAttribute("data-console-state");

function speak(source: MessageEventSource | null, origin: string, data: unknown) {
	window.dispatchEvent(new MessageEvent("message", { data, origin, source }));
}
const state = (seqs: number[], extra: Record<string, unknown> = {}) => ({
	protocol: "gradio-console",
	version: 1,
	type: "state",
	session_id: "s1",
	gradio_version: "6.31.0",
	dropped: 0,
	entries: seqs.map((seq) => ({ seq, ts: 1, level: "error", text: `e${seq}` })),
	...extra,
});

const loads = () => posts.filter((post) => post.state === "loading");
const LOAD_WAIT = { timeout: 20_000 };

async function mounted() {
	sidePane.openSpace(SPACE);
	const view = render(SpacePane, { items, conversationId: CONV });
	await tick();
	await vi.waitFor(() => expect(loads()).toHaveLength(1), LOAD_WAIT);
	return view.container;
}

describe("SpacePane console forwarding", () => {
	it("reports the load, then each snapshot with only new entries and the check it answers", async () => {
		const root = await mounted();
		const frame = frameOf(root);
		expect(new URL(frame.src).origin).toBe(ORIGIN);
		expect(frame.getAttribute("sandbox")).toBe(
			"allow-scripts allow-same-origin allow-forms allow-downloads"
		);
		const load = loads()[0];
		expect(load).toEqual({
			space: SPACE.spaceId,
			load: load.load,
			state: "loading",
			check: "check-1",
		});
		expect(stateOf(root)).toBe("connecting");

		speak(frame.contentWindow, ORIGIN, state([1, 2], { id: "check-1", dropped: 4 }));
		await tick();
		expect(stateOf(root)).toBe("connected");
		await vi.waitFor(() => expect(posts.some((post) => post.answers)).toBe(true));
		expect(posts.slice(1)).toEqual([
			{
				space: SPACE.spaceId,
				load: load.load,
				state: "connected",
				session_id: "s1",
				gradio_version: "6.31.0",
			},
			{
				space: SPACE.spaceId,
				load: load.load,
				session_id: "s1",
				gradio_version: "6.31.0",
				dropped: 4,
				entries: [
					{ session_id: "s1", seq: 1, ts: 1, level: "error", text: "e1" },
					{ session_id: "s1", seq: 2, ts: 1, level: "error", text: "e2" },
				],
				answers: "check-1",
			},
		]);

		speak(frame.contentWindow, ORIGIN, state([1, 2, 3], { dropped: 4 }));
		await vi.waitFor(() => expect(posts).toHaveLength(4));
		expect((posts[3].entries as { seq: number }[]).map((e) => e.seq)).toEqual([3]);
		expect(posts[3]).not.toHaveProperty("answers");
		expect(root.textContent).toContain("3");
	});

	it("sends a load's state only after its loading post has been answered", async () => {
		let release!: () => void;
		holdLoading = new Promise((resolve) => (release = resolve));
		const root = await mounted();
		speak(frameOf(root).contentWindow, ORIGIN, state([1]));
		await new Promise((r) => setTimeout(r, 200));
		expect(posts.map((post) => post.state)).toEqual(["loading"]);
		release();
		await vi.waitFor(() => expect(posts).toHaveLength(3));
		expect(posts.map((post) => post.state)).toEqual(["loading", "connected", undefined]);
	});

	it("posts a snapshot to the conversation that produced it after a switch", async () => {
		let release!: () => void;
		holdLoading = new Promise((resolve) => (release = resolve));
		sidePane.openSpace(SPACE);
		const view = render(SpacePane, { items, conversationId: CONV });
		await vi.waitFor(() => expect(loads()).toHaveLength(1), LOAD_WAIT);
		speak(frameOf(view.container).contentWindow, ORIGIN, state([1]));
		await view.rerender({ items, conversationId: "6ad03a4c353929f19edc5610" });
		release();
		await vi.waitFor(() => expect(posts.some((post) => post.entries)).toBe(true));
		const at = posts.findIndex((post) => post.entries);
		expect(postUrls[at]).toBe(`/conversation/${CONV}/space-console`);
	});

	it("ignores another window and another origin", async () => {
		const root = await mounted();
		speak(window, ORIGIN, state([1]));
		speak(frameOf(root).contentWindow, "https://evil.hf.space", state([1]));
		await tick();
		expect(stateOf(root)).toBe("connecting");
		expect(posts).toHaveLength(1);
	});

	it("marks a silent frame unsupported at 5 s, keeps the Space, and upgrades on a late answer", async () => {
		const root = await mounted();
		const frame = frameOf(root);
		await new Promise((r) => setTimeout(r, 4000));
		expect(stateOf(root)).toBe("connecting");
		await vi.waitFor(() => expect(stateOf(root)).toBe("unsupported"), { timeout: 3000 });
		expect(frameOf(root)).toBe(frame);
		expect(sidePane.open).toBe(true);
		await vi.waitFor(() => expect(posts.at(-1)).toMatchObject({ state: "unsupported" }));
		expect(root.textContent).toContain("No console");

		sidePane.followSpaceCheck({ ...SPACE, checkId: "check-2" });
		await vi.waitFor(() => expect(posts.at(-1)).toMatchObject({ check: "check-2" }));
		expect(loads()).toHaveLength(1);
		expect(frameOf(root)).toBe(frame);
		speak(frame.contentWindow, ORIGIN, state([1], { id: "check-2" }));
		await tick();
		expect(stateOf(root)).toBe("connected");
		await vi.waitFor(() => expect(posts.at(-1)).toMatchObject({ answers: "check-2" }));
	}, 15_000);

	it("restarts the sequence when the frame reloads", async () => {
		const root = await mounted();
		speak(frameOf(root).contentWindow, ORIGIN, state([1]));
		await tick();
		expect(stateOf(root)).toBe("connected");

		(root.querySelector('button[title="Reload the Space"]') as HTMLButtonElement).click();
		await vi.waitFor(() => expect(loads()).toHaveLength(2), LOAD_WAIT);
		expect(loads()[1].load).not.toBe(loads()[0].load);
		expect(stateOf(root)).toBe("connecting");

		speak(frameOf(root).contentWindow, ORIGIN, state([1], { session_id: "s2" }));
		await vi.waitFor(() =>
			expect(
				posts.find((post) => post.state === "connected" && post.load === loads()[1].load)
			).toMatchObject({ session_id: "s2" })
		);
	});

	it("asks the frame it shows again for a new check, without reloading it", async () => {
		const root = await mounted();
		const frame = frameOf(root);
		sidePane.followSpaceCheck({ ...SPACE, checkId: "check-2" });
		await vi.waitFor(() =>
			expect(posts.at(-1)).toEqual({
				space: SPACE.spaceId,
				load: loads()[0].load,
				check: "check-2",
			})
		);
		await new Promise((r) => setTimeout(r, 300));
		expect(loads()).toHaveLength(1);
		expect(frameOf(root)).toBe(frame);
		expect(sidePane.space?.checkId).toBe("check-2");
	});

	it("frames a private Space with the token the server minted, once per Space", async () => {
		sidePane.openSpace({ ...SPACE, private: true });
		const { container } = render(SpacePane, {
			items: [{ ...items[0], private: true }],
			conversationId: CONV,
		});
		await vi.waitFor(() => expect(frameOf(container)).toBeTruthy());
		const frame = frameOf(container);
		expect(gets).toEqual([
			`/conversation/${CONV}/space-console?space=${encodeURIComponent(SPACE.spaceId)}`,
		]);
		expect(new URL(frame.src).searchParams.get("__sign")).toBe("jwt-123");
		sidePane.followSpaceCheck({ ...SPACE, private: true, checkId: "check-2" });
		await new Promise((r) => setTimeout(r, 300));
		expect(gets).toHaveLength(1);
		expect(frameOf(container)).toBe(frame);
	});

	it("shows the Space without any handshake on a shared view", async () => {
		sidePane.openSpace(SPACE);
		const { container } = render(SpacePane, { items });
		const frame = await vi.waitFor(() => {
			const found = frameOf(container);
			expect(found).toBeTruthy();
			return found;
		});
		await new Promise((r) => setTimeout(r, 1500));
		speak(frame.contentWindow, ORIGIN, state([1]));
		await tick();
		expect(stateOf(container)).toBeUndefined();
		expect(posts).toEqual([]);
	});
});
