import SpacePane from "./SpacePane.svelte";
import { render } from "vitest-browser-svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import { sidePane, type SidePaneSpace } from "$lib/stores/sidePane.svelte";

// no such space, the hub 404 page never answers init
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
let gets: string[];

beforeEach(() => {
	posts = [];
	gets = [];
	vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
		const url = String(input);
		if (init?.method === "POST") {
			posts.push(JSON.parse(String(init.body)));
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
const ack = (session = "s1") => ({
	protocol: "gradio-console",
	version: 1,
	type: "ack",
	session_id: session,
	gradio_version: "6.31.0",
	dropped: 0,
});
const entries = (seqs: number[], session = "s1") => ({
	protocol: "gradio-console",
	version: 1,
	type: "entries",
	session_id: session,
	dropped: 0,
	entries: seqs.map((seq) => ({ seq, ts: 1, level: "error", text: `e${seq}` })),
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
	it("reports the load, the ack and batched, deduped entries for this check", async () => {
		const root = await mounted();
		const frame = frameOf(root);
		expect(new URL(frame.src).origin).toBe(ORIGIN);
		expect(frame.getAttribute("sandbox")).toBe(
			"allow-scripts allow-same-origin allow-forms allow-downloads"
		);
		const load = loads()[0];
		expect(load).toMatchObject({ space: SPACE.spaceId, check: "check-1" });
		expect(stateOf(root)).toBe("connecting");

		speak(frame.contentWindow, ORIGIN, ack());
		await tick();
		expect(stateOf(root)).toBe("connected");
		expect(posts.at(-1)).toEqual({
			space: SPACE.spaceId,
			load: load.load,
			check: "check-1",
			state: "connected",
			session_id: "s1",
			gradio_version: "6.31.0",
		});

		speak(frame.contentWindow, ORIGIN, entries([1, 2]));
		speak(frame.contentWindow, ORIGIN, entries([2, 3]));
		await vi.waitFor(() => expect(posts.some((post) => post.entries)).toBe(true));
		const batches = posts.filter((post) => post.entries);
		expect(batches).toHaveLength(1);
		expect((batches[0].entries as { seq: number }[]).map((e) => e.seq)).toEqual([1, 2, 3]);
		expect(batches[0]).toMatchObject({ load: load.load, check: "check-1" });
		expect(root.textContent).toContain("3");
	});

	it("ignores another window and another origin", async () => {
		const root = await mounted();
		speak(window, ORIGIN, ack());
		speak(frameOf(root).contentWindow, "https://evil.hf.space", ack());
		await tick();
		expect(stateOf(root)).toBe("connecting");
		expect(posts.filter((post) => post.state === "connected")).toEqual([]);
	});

	it("marks a frame that never acks unsupported after 5 s and keeps showing the Space", async () => {
		const root = await mounted();
		const frame = frameOf(root);
		await new Promise((r) => setTimeout(r, 4000));
		expect(stateOf(root)).toBe("connecting");
		await vi.waitFor(() => expect(stateOf(root)).toBe("unsupported"), { timeout: 3000 });
		expect(frameOf(root)).toBe(frame);
		expect(sidePane.open).toBe(true);
		expect(posts.at(-1)).toMatchObject({ state: "unsupported", check: "check-1" });
		expect(root.textContent).toContain("No console");
	}, 15_000);

	it("restarts the handshake when the frame reloads", async () => {
		const root = await mounted();
		speak(frameOf(root).contentWindow, ORIGIN, ack());
		await tick();
		expect(stateOf(root)).toBe("connected");

		(root.querySelector('button[title="Reload the Space"]') as HTMLButtonElement).click();
		await vi.waitFor(() => expect(loads()).toHaveLength(2), LOAD_WAIT);
		expect(loads()[1].load).not.toBe(loads()[0].load);
		expect(stateOf(root)).toBe("connecting");

		speak(frameOf(root).contentWindow, ORIGIN, ack("s2"));
		await tick();
		expect(posts.at(-1)).toMatchObject({ state: "connected", session_id: "s2" });
	});

	it("reloads for a new check of the Space it shows, tagged with that check", async () => {
		const root = await mounted();
		sidePane.followSpaceCheck({ ...SPACE, checkId: "check-2" });
		await vi.waitFor(() => expect(loads()).toHaveLength(2), LOAD_WAIT);
		expect(loads()[1].check).toBe("check-2");
		expect(sidePane.space?.checkId).toBe("check-2");
		expect(frameOf(root)).toBeTruthy();
	});

	it("frames a private Space with the token the server minted", async () => {
		sidePane.openSpace({ ...SPACE, private: true });
		const { container } = render(SpacePane, {
			items: [{ ...items[0], private: true }],
			conversationId: CONV,
		});
		await vi.waitFor(() => expect(frameOf(container)).toBeTruthy());
		expect(gets).toEqual([
			`/conversation/${CONV}/space-console?space=${encodeURIComponent(SPACE.spaceId)}`,
		]);
		expect(new URL(frameOf(container).src).searchParams.get("__sign")).toBe("jwt-123");
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
		speak(frame.contentWindow, ORIGIN, ack());
		await tick();
		expect(stateOf(container)).toBeUndefined();
		expect(posts).toEqual([]);
	});
});
