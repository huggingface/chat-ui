import { afterEach, describe, expect, it } from "vitest";
import { createChatScroll } from "../chatScroll.svelte";
import { anchorMinHeight, MIN_CLEARANCE_PX } from "../geometry";
import { createTurnDom, type TurnDom } from "./turnDom.svelte";
import {
	createFixture,
	dragScrollbarTo,
	frame,
	frames,
	nextTask,
	pressKey,
	startClsProbe,
	waitFor,
	wheel,
	type Fixture,
} from "./harness";

const ARRIVED = 2;
const ANCHOR_OFFSET = 50;
/** The reservation at the default fixture geometry (400px viewport, 208px clearance). */
const RESERVATION = anchorMinHeight(400, MIN_CLEARANCE_PX);

interface ChatFixture {
	fixture: Fixture;
	chat: ReturnType<typeof createChatScroll>;
	dom: TurnDom;
	messages: { id: string; from: "user" | "assistant"; terminal?: boolean }[];
	sync: (opts?: { loading?: boolean; conversationKey?: string }) => void;
	/** Mount a fresh turn — user message plus (empty) reply — as a send does,
	 * with `loading` already true unless overridden. */
	mountPair: (
		userHeight?: number,
		opts?: { empty?: boolean; loading?: boolean }
	) => { user: HTMLDivElement; assistant: HTMLDivElement; key: string };
	/** Swap the trailing reply for a fresh empty sibling — a regenerate. */
	swapAssistant: (opts?: { loading?: boolean }) => HTMLDivElement;
	/** Mark the trailing reply terminal — the stream is over. */
	settleLast: () => void;
	/** The post-stream server reconciliation: every message (and so every
	 * turn) gets a fresh identity, content and geometry unchanged. */
	reKeyAll: (opts?: { loading?: boolean }) => void;
	lastAssistant: () => HTMLDivElement;
	growLastAssistant: (px: number) => void;
	lastGroupMinHeight: () => string;
	viewportTop: () => number;
	destroy: () => void;
}

let active: ChatFixture[] = [];
afterEach(() => {
	for (const c of active) c.destroy();
	active = [];
});

function createChat({
	turns = 3,
	viewportHeight = 400,
	firstSyncLoading = false,
	lastTerminal = true,
} = {}): ChatFixture {
	const fixture = createFixture({ viewportHeight, blocks: [] });
	const chat = createChatScroll();
	const dom = createTurnDom(chat, fixture.content);
	const messages: ChatFixture["messages"] = [];
	let n = 0;
	let lastAssistantEl: HTMLDivElement | null = null;

	const blockEl = (height: number, opts: { user?: boolean; id: string }) => {
		const el = document.createElement("div");
		el.style.cssText = `height: ${height}px; flex-shrink: 0; background: ${
			opts.user ? "#dbeafe" : "#f3f4f6"
		};`;
		el.dataset.messageId = opts.id;
		if (opts.user) el.dataset.messageType = "user";
		return el;
	};

	const newGroup = (key: string) => {
		const el = document.createElement("div");
		el.style.cssText = "display: flex; flex-direction: column; flex-shrink: 0;";
		fixture.content.appendChild(el);
		dom.addGroup(key, el);
		return el;
	};

	const addTurn = (userHeight = 60, assistantHeight = 220) => {
		const userId = `u${++n}`;
		const assistantId = `a${n}`;
		const group = newGroup(userId);
		group.appendChild(blockEl(userHeight, { user: true, id: userId }));
		lastAssistantEl = group.appendChild(blockEl(assistantHeight, { id: assistantId }));
		messages.push(
			{ id: userId, from: "user" },
			{ id: assistantId, from: "assistant", terminal: true }
		);
	};
	for (let i = 0; i < turns; i++) addTurn();
	if (!lastTerminal && messages.length) {
		messages[messages.length - 1].terminal = false;
	}

	const containerAction = chat.attach(fixture.container, { content: () => fixture.content });

	const api: ChatFixture = {
		fixture,
		chat,
		dom,
		messages,
		sync({ loading = false, conversationKey = "c1" } = {}) {
			// Mirrors ChatWindow's structural effect, terminal check included.
			const last = messages.at(-1);
			const lastTurnKey = dom.groups.at(-1)?.key ?? null;
			const streaming = loading && last?.from === "assistant" && !last.terminal;
			chat.sync({
				conversationKey,
				turnCount: dom.groups.length,
				lastTurnKey,
				streamingTurnKey: streaming ? lastTurnKey : null,
			});
			dom.flush();
		},
		mountPair(userHeight = 40, { empty = true, loading = true } = {}) {
			const userId = `u${++n}`;
			const assistantId = `a${n}`;
			const group = newGroup(userId);
			const user = group.appendChild(blockEl(userHeight, { user: true, id: userId }));
			const assistant = group.appendChild(blockEl(empty ? 0 : 60, { id: assistantId }));
			lastAssistantEl = assistant;
			messages.push(
				{ id: userId, from: "user" },
				{ id: assistantId, from: "assistant", terminal: false }
			);
			api.sync({ loading });
			return { user, assistant, key: userId };
		},
		swapAssistant({ loading = true } = {}) {
			const group = dom.groups.at(-1);
			if (!group) throw new Error("no turn to regenerate");
			lastAssistantEl?.remove();
			messages.pop();
			const assistantId = `a${++n}`;
			const assistant = group.el.appendChild(blockEl(0, { id: assistantId }));
			lastAssistantEl = assistant;
			messages.push({ id: assistantId, from: "assistant", terminal: false });
			api.sync({ loading });
			return assistant;
		},
		settleLast() {
			const last = messages.at(-1);
			if (last) last.terminal = true;
			api.sync({ loading: false });
		},
		reKeyAll({ loading = false } = {}) {
			for (const group of dom.groups) {
				group.key = `rekeyed-${group.key}`;
			}
			for (const message of messages) {
				message.id = `rekeyed-${message.id}`;
			}
			api.sync({ loading });
		},
		lastAssistant() {
			if (!lastAssistantEl) throw new Error("no assistant mounted");
			return lastAssistantEl;
		},
		growLastAssistant(px) {
			const el = api.lastAssistant();
			el.style.height = `${parseFloat(el.style.height) + px}px`;
		},
		lastGroupMinHeight() {
			return dom.groups.at(-1)?.el.style.minHeight ?? "";
		},
		viewportTop: () => fixture.container.getBoundingClientRect().top,
		destroy() {
			containerAction.destroy();
			dom.dispose();
			fixture.destroy();
		},
	};
	api.sync({ loading: firstSyncLoading });
	active.push(api);
	return api;
}

function topOf(el: Element, chat: ChatFixture): number {
	return el.getBoundingClientRect().top - chat.viewportTop();
}

describe("send anchoring", () => {
	it("anchors the sent message ~50px below the viewport top, landing in read mode", async () => {
		const chat = createChat();
		chat.chat.notifySend();
		const { user } = chat.mountPair();
		await waitFor(() => Math.abs(topOf(user, chat) - ANCHOR_OFFSET) <= 2, {
			label: "user message glides to the anchor offset",
		});
		expect(chat.fixture.distance()).toBeLessThanOrEqual(ARRIVED); // the anchor IS the bottom while filling
		expect(chat.lastGroupMinHeight()).toBe(`${RESERVATION}px`);
		// Detached: following is the reader's choice from here on.
		expect(chat.chat.state.pinned).toBe(false);
	});

	it("fill phase: constant scrollHeight, zero scroll movement, zero layout shift", async () => {
		const chat = createChat();
		chat.chat.notifySend();
		const { user, assistant } = chat.mountPair();
		await waitFor(() => Math.abs(topOf(user, chat) - ANCHOR_OFFSET) <= 2, { label: "anchored" });
		await frames(3); // let everything paint before probing
		const probe = startClsProbe();
		const scrollHeightBefore = chat.fixture.container.scrollHeight;
		const scrollTopBefore = chat.fixture.scrollTop();
		// Stream 80px into a reservation with ~100px of headroom left.
		for (let i = 0; i < 16; i++) {
			assistant.style.height = `${parseFloat(assistant.style.height) + 5}px`;
			await frame();
			expect(chat.fixture.container.scrollHeight).toBe(scrollHeightBefore);
			expect(chat.fixture.scrollTop()).toBe(scrollTopBefore);
		}
		await frames(3);
		expect(probe.score()).toBe(0);
		expect(Math.abs(topOf(user, chat) - ANCHOR_OFFSET)).toBeLessThanOrEqual(2);
		probe.stop();
	});

	it("read mode: a reply outgrowing its reservation never moves the view; the jump button appears", async () => {
		const chat = createChat();
		chat.chat.notifySend();
		const { assistant } = chat.mountPair();
		await waitFor(() => chat.fixture.distance() <= ARRIVED, { label: "anchored" });
		await frames(3);
		const scrollTop = chat.fixture.scrollTop();
		for (let i = 0; i < 60; i++) {
			assistant.style.height = `${parseFloat(assistant.style.height) + 10}px`;
			await frame();
			expect(chat.fixture.scrollTop()).toBe(scrollTop);
		}
		await frames(3);
		expect(chat.fixture.scrollTop()).toBe(scrollTop);
		expect(chat.fixture.distance()).toBeGreaterThan(200);
		expect(chat.chat.state.pinned).toBe(false);
		expect(chat.chat.showJumpToBottom).toBe(true);
	});

	it("scrolling down to the bottom during read mode engages following", async () => {
		const chat = createChat();
		chat.chat.notifySend();
		const { assistant } = chat.mountPair();
		await waitFor(() => chat.fixture.distance() <= ARRIVED, { label: "anchored" });
		assistant.style.height = "400px"; // outgrew the reservation
		await frames(3);
		expect(chat.chat.state.pinned).toBe(false);
		await nextTask();
		dragScrollbarTo(chat.fixture.container, chat.fixture.maxScrollTop());
		await frame();
		expect(chat.chat.state.pinned).toBe(true);
		assistant.style.height = "700px";
		await waitFor(() => chat.fixture.distance() <= ARRIVED, { label: "follows again" });
	});

	it("the End key engages following during read mode (a single-jump input after growth)", async () => {
		const chat = createChat();
		chat.chat.notifySend();
		const { assistant } = chat.mountPair();
		await waitFor(() => chat.fixture.distance() <= ARRIVED, { label: "anchored" });
		assistant.style.height = "400px"; // outgrew the reservation; baselines now stale
		await frames(3);
		expect(chat.chat.state.pinned).toBe(false);
		await nextTask();
		pressKey(chat.fixture.container, "End");
		await frame();
		expect(chat.chat.state.pinned).toBe(true);
	});

	it("the jump button engages following during read mode", async () => {
		const chat = createChat();
		chat.chat.notifySend();
		const { assistant } = chat.mountPair();
		await waitFor(() => chat.fixture.distance() <= ARRIVED, { label: "anchored" });
		assistant.style.height = "500px";
		await frames(3);
		expect(chat.chat.showJumpToBottom).toBe(true);
		chat.chat.scrollToBottom();
		await waitFor(() => chat.fixture.distance() <= ARRIVED, { label: "jump lands on the bottom" });
		expect(chat.chat.state.pinned).toBe(true);
		assistant.style.height = "800px";
		await waitFor(() => chat.fixture.distance() <= ARRIVED, { label: "keeps following" });
	});

	it("a new send resets to read mode even when the user was following", async () => {
		const chat = createChat();
		chat.chat.notifySend();
		const first = chat.mountPair();
		await waitFor(() => chat.fixture.distance() <= ARRIVED, { label: "anchored" });
		first.assistant.style.height = "500px";
		await frames(3);
		chat.chat.scrollToBottom();
		await waitFor(() => chat.fixture.distance() <= ARRIVED, { label: "following" });
		expect(chat.chat.state.pinned).toBe(true);
		chat.settleLast();
		chat.chat.notifySend();
		const second = chat.mountPair();
		await waitFor(() => Math.abs(topOf(second.user, chat) - ANCHOR_OFFSET) <= 2, {
			label: "new exchange anchors",
		});
		expect(chat.chat.state.pinned).toBe(false);
	});

	it("the first exchange anchors like any other turn", async () => {
		const chat = createChat({ turns: 0 });
		chat.chat.notifySend();
		chat.mountPair();
		await frames(3);
		expect(chat.lastGroupMinHeight()).toBe(`${RESERVATION}px`);
		await waitFor(() => chat.fixture.distance() <= ARRIVED, { label: "pinned to bottom" });
	});

	it("the reservation is kept after the stream ends (no end-of-turn jump)", async () => {
		const chat = createChat();
		chat.chat.notifySend();
		const { assistant } = chat.mountPair();
		await waitFor(() => chat.fixture.distance() <= ARRIVED, { label: "anchored" });
		assistant.style.height = "60px"; // short reply, stream over
		chat.settleLast();
		await frames(4);
		expect(chat.lastGroupMinHeight()).toBe(`${RESERVATION}px`);
		const scrollTop = chat.fixture.scrollTop();
		await frames(10);
		expect(chat.fixture.scrollTop()).toBe(scrollTop);
		expect(chat.lastGroupMinHeight()).toBe(`${RESERVATION}px`);
	});

	it("the post-stream server reconciliation re-keys every turn: the reservation carries over, nothing moves", async () => {
		const chat = createChat();
		chat.chat.notifySend();
		const { assistant } = chat.mountPair();
		await waitFor(() => chat.fixture.distance() <= ARRIVED, { label: "anchored" });
		assistant.style.height = "60px";
		chat.settleLast();
		await frames(3);
		const scrollTop = chat.fixture.scrollTop();
		const scrollHeight = chat.fixture.container.scrollHeight;
		// The invalidate lands: same turns, entirely new identities.
		chat.reKeyAll();
		await frames(4);
		expect(chat.lastGroupMinHeight()).toBe(`${RESERVATION}px`);
		expect(chat.fixture.container.scrollHeight).toBe(scrollHeight);
		expect(chat.fixture.scrollTop()).toBe(scrollTop);
		expect(chat.chat.state.pinned).toBe(false); // read mode, untouched by the swap
	});

	it("send carries a detached reader to the new exchange (sending is the request to see it)", async () => {
		const chat = createChat({ turns: 5 });
		wheel(chat.fixture.container, -600);
		await frame();
		expect(chat.chat.state.pinned).toBe(false);
		chat.chat.notifySend();
		const { user } = chat.mountPair();
		await waitFor(() => Math.abs(topOf(user, chat) - ANCHOR_OFFSET) <= 2, {
			label: "carried down to the new exchange",
		});
		expect(chat.chat.state.pinned).toBe(false); // read mode on arrival
	});

	it("scrolling up while a send is in flight revokes its pin but keeps the reservation", async () => {
		const chat = createChat();
		chat.chat.notifySend();
		wheel(chat.fixture.container, -300); // reads up while waiting
		await frame();
		const scrollTop = chat.fixture.scrollTop();
		chat.mountPair();
		await frames(4);
		expect(chat.chat.state.pinned).toBe(false);
		expect(chat.fixture.scrollTop()).toBe(scrollTop);
		expect(chat.lastGroupMinHeight()).toBe(`${RESERVATION}px`);
	});

	it("still anchors a pair that mounts late (attachment encoding has no deadline)", async () => {
		const chat = createChat();
		chat.chat.notifySend();
		// The pre-mount gap: loading is on but the trailing message is still the
		// previous, settled reply — which must NOT anchor (its turn inflating
		// and deflating around the mount is the visible bug this guards).
		chat.sync({ loading: true });
		await frames(10); // encoding, MCP hydration…
		expect(chat.lastGroupMinHeight()).toBe("");
		const { user } = chat.mountPair();
		await waitFor(() => Math.abs(topOf(user, chat) - ANCHOR_OFFSET) <= 2, {
			label: "late pair still anchors",
		});
	});

	it("anchors a pair that mounts already carrying its first tokens", async () => {
		const chat = createChat();
		chat.chat.notifySend();
		const { user } = chat.mountPair(40, { empty: false });
		await waitFor(() => Math.abs(topOf(user, chat) - ANCHOR_OFFSET) <= 2, { label: "anchored" });
		expect(chat.chat.state.pinned).toBe(false);
	});

	it("a send glide never shows the jump button, even though it lands detached", async () => {
		const chat = createChat({ turns: 8 });
		dragScrollbarTo(chat.fixture.container, 0);
		await frame();
		chat.chat.notifySend();
		chat.mountPair();
		let sawButton = false;
		while (chat.fixture.distance() > ARRIVED) {
			sawButton ||= chat.chat.showJumpToBottom;
			await frame();
		}
		expect(sawButton).toBe(false);
		expect(chat.chat.state.pinned).toBe(false);
	});
});

describe("regenerate & branches", () => {
	it("regenerate from a scrolled-up position never moves the view", async () => {
		const chat = createChat({ turns: 5 });
		wheel(chat.fixture.container, -500);
		await frame();
		const scrollTop = chat.fixture.scrollTop();
		chat.swapAssistant(); // old reply collapses, empty sibling mounts, loading on
		await frames(4);
		expect(chat.fixture.scrollTop()).toBe(scrollTop);
		expect(chat.chat.state.pinned).toBe(false);
		// The reservation was still put in place, quietly, below the fold.
		expect(chat.lastGroupMinHeight()).toBe(`${RESERVATION}px`);
	});

	it("regenerate at the bottom re-anchors the turn, in read mode", async () => {
		const chat = createChat({ turns: 5 });
		chat.swapAssistant();
		await frames(3);
		expect(chat.chat.state.pinned).toBe(false);
		const userEl = chat.fixture.container.querySelector('[data-message-id="u5"]');
		expect(userEl).not.toBeNull();
		await waitFor(
			() => userEl instanceof Element && Math.abs(topOf(userEl, chat) - ANCHOR_OFFSET) <= 2,
			{ label: "turn re-anchors at the offset" }
		);
	});

	it("regenerating the anchored turn absorbs the collapse — zero motion, no clamp", async () => {
		const chat = createChat();
		chat.chat.notifySend();
		const { assistant } = chat.mountPair();
		await waitFor(() => chat.fixture.distance() <= ARRIVED, { label: "anchored" });
		assistant.style.height = "90px"; // the reply streamed a while
		chat.sync({ loading: false }); // …and settled
		await frames(3);
		const scrollTop = chat.fixture.scrollTop();
		const scrollHeight = chat.fixture.container.scrollHeight;
		chat.swapAssistant(); // regenerate: 90px of reply collapse inside the reservation
		await frames(4);
		expect(chat.fixture.container.scrollHeight).toBe(scrollHeight);
		expect(chat.fixture.scrollTop()).toBe(scrollTop);
		expect(chat.chat.state.pinned).toBe(false);
	});

	it("cycling alternatives of the anchored turn keeps its reservation (stable comparison box)", async () => {
		const chat = createChat();
		chat.chat.notifySend();
		const { assistant } = chat.mountPair();
		await waitFor(() => chat.fixture.distance() <= ARRIVED, { label: "anchored" });
		assistant.style.height = "90px";
		chat.settleLast();
		await frames(3);
		const scrollTop = chat.fixture.scrollTop();
		// ‹ › on the reply: a different assistant sibling, same turn key.
		chat.chat.notifyBranchSwitch();
		chat.swapAssistant({ loading: false });
		await frames(4);
		expect(chat.lastGroupMinHeight()).toBe(`${RESERVATION}px`);
		expect(chat.fixture.scrollTop()).toBe(scrollTop);
	});

	it("switching to a branch with a different trailing turn drops the reservation", async () => {
		const chat = createChat();
		chat.chat.notifySend();
		const { assistant } = chat.mountPair();
		await waitFor(() => chat.fixture.distance() <= ARRIVED, { label: "anchored" });
		assistant.style.height = "60px";
		chat.settleLast();
		await frames(3);
		// ‹ › on the anchored turn's USER message: an edited alternative — a
		// different turn entirely takes the trailing position.
		chat.chat.notifyBranchSwitch();
		chat.dom.removeLastGroup()?.remove();
		chat.messages.pop();
		chat.messages.pop();
		const group = document.createElement("div");
		group.style.cssText = "display: flex; flex-direction: column; flex-shrink: 0;";
		chat.fixture.content.appendChild(group);
		chat.dom.addGroup("alt-u", group);
		const user = document.createElement("div");
		user.style.cssText = "height: 40px; flex-shrink: 0;";
		user.dataset.messageId = "alt-u";
		user.dataset.messageType = "user";
		group.appendChild(user);
		const reply = document.createElement("div");
		reply.style.cssText = "height: 60px; flex-shrink: 0;";
		reply.dataset.messageId = "alt-a";
		group.appendChild(reply);
		chat.messages.push(
			{ id: "alt-u", from: "user" },
			{ id: "alt-a", from: "assistant", terminal: true }
		);
		chat.sync();
		await frames(4);
		expect(chat.chat.anchoredTurnKey).toBe(null);
		expect(chat.lastGroupMinHeight()).toBe("");
	});

	it("branch switch keeps the compared message stationary (shorter branch clamps, no teleport)", async () => {
		const chat = createChat({ turns: 6 });
		dragScrollbarTo(chat.fixture.container, 300);
		await frame();
		chat.chat.notifyBranchSwitch();
		// Shorter alternative: drop the last two turns.
		for (let i = 0; i < 2; i++) {
			chat.dom.removeLastGroup()?.remove();
			chat.messages.pop();
			chat.messages.pop();
		}
		chat.sync();
		await frames(4);
		expect(chat.chat.state.pinned).toBe(false);
		// Kept in place, clamped only if the shorter branch forces it.
		expect(chat.fixture.scrollTop()).toBe(Math.min(300, chat.fixture.maxScrollTop()));
	});

	it("a branch switch onto an empty errored sibling anchors nothing (no stream is running)", async () => {
		const chat = createChat({ turns: 4 });
		chat.chat.notifyBranchSwitch();
		chat.dom.removeLastGroup()?.remove();
		chat.messages.pop();
		chat.messages.pop();
		// The alternative's leaf: an assistant stopped before its first token.
		const group = document.createElement("div");
		group.style.cssText = "display: flex; flex-direction: column; flex-shrink: 0;";
		chat.fixture.content.appendChild(group);
		chat.dom.addGroup("err-u", group);
		const user = document.createElement("div");
		user.style.cssText = "height: 60px; flex-shrink: 0;";
		user.dataset.messageId = "err-u";
		user.dataset.messageType = "user";
		group.appendChild(user);
		const sibling = document.createElement("div");
		sibling.style.cssText = "height: 0px; flex-shrink: 0;";
		sibling.dataset.messageId = "err-a";
		group.appendChild(sibling);
		chat.messages.push({ id: "err-u", from: "user" }, { id: "err-a", from: "assistant" });
		chat.sync(); // not loading: nothing latches
		await frames(3);
		expect(chat.lastGroupMinHeight()).toBe("");
		// A real send afterwards still anchors normally.
		chat.chat.notifySend();
		const { user: sent } = chat.mountPair();
		await waitFor(() => Math.abs(topOf(sent, chat) - ANCHOR_OFFSET) <= 2, {
			label: "real pair anchors",
		});
	});
});

describe("conversation switch", () => {
	it("resets instantly: bottom, pinned, reservation cleared", async () => {
		const chat = createChat({ turns: 5 });
		chat.chat.notifySend();
		chat.mountPair();
		await waitFor(() => chat.fixture.distance() <= ARRIVED, { label: "anchored" });
		wheel(chat.fixture.container, -400);
		await frame();
		chat.sync({ conversationKey: "c2" });
		await frame();
		expect(chat.chat.state.pinned).toBe(true);
		expect(chat.fixture.distance()).toBeLessThanOrEqual(ARRIVED);
		expect(chat.chat.anchoredTurnKey).toBe(null);
		expect(chat.lastGroupMinHeight()).toBe("");
	});

	it("content settling after a switch lands at the bottom with no glide", async () => {
		const chat = createChat({ turns: 5 });
		chat.sync({ conversationKey: "c2" });
		await frame();
		// The switched-to conversation keeps inflating after the reset (async
		// markdown, images, code highlighting) — every growth must land at the
		// bottom in a snap instead of playing a visible scroll animation.
		chat.growLastAssistant(700);
		await waitFor(() => chat.fixture.distance() <= ARRIVED, {
			maxFrames: 6,
			label: "snaps to the bottom",
		});
	});

	it("adopts a mid-stream conversation's anchor on open, following (no read mode on open)", async () => {
		const chat = createChat({ turns: 2, firstSyncLoading: true, lastTerminal: false });
		expect(chat.chat.anchoredTurnKey).toBe("u2");
		expect(chat.chat.state.pinned).toBe(true);
		await frames(3);
		expect(chat.lastGroupMinHeight()).toBe(`${RESERVATION}px`);
		await waitFor(() => chat.fixture.distance() <= ARRIVED, { label: "at the bottom" });
	});
});

describe("follow behavior", () => {
	it("idle content growth (late images, initial load) snaps to the bottom", async () => {
		const chat = createChat();
		chat.growLastAssistant(700);
		await waitFor(() => chat.fixture.distance() <= ARRIVED, {
			maxFrames: 6, // snap arrives in a few frames; a glide cannot
			label: "snaps to the bottom",
		});
	});
});

describe("floating buttons", () => {
	it("stay hidden while pinned — including during glides — and follow show/hide hysteresis", async () => {
		const chat = createChat({ turns: 8 });
		expect(chat.chat.showJumpToBottom).toBe(false);

		// Pinned glide over a long distance: never visible.
		dragScrollbarTo(chat.fixture.container, 0);
		await frame();
		chat.chat.scrollToBottom();
		let sawButton = false;
		while (chat.fixture.distance() > ARRIVED) {
			sawButton ||= chat.chat.showJumpToBottom;
			await frame();
		}
		expect(sawButton).toBe(false);

		// Detached: appears past 200px…
		wheel(chat.fixture.container, -300);
		await frame();
		expect(chat.chat.showJumpToBottom).toBe(true);
		// …stays through the 60-200px band (hysteresis)…
		dragScrollbarTo(chat.fixture.container, chat.fixture.maxScrollTop() - 120);
		await frame();
		expect(chat.chat.showJumpToBottom).toBe(true);
		// …and hides in the re-attach zone.
		dragScrollbarTo(chat.fixture.container, chat.fixture.maxScrollTop() - 30);
		await frame();
		expect(chat.chat.showJumpToBottom).toBe(false);
	});

	it("scroll-to-previous lands the previous user turn at the anchor offset, detached", async () => {
		const chat = createChat({ turns: 6 });
		const container = chat.fixture.container;
		const userBlocks = [...container.querySelectorAll('[data-message-type="user"]')];
		const expected = userBlocks
			.filter((el) => el.getBoundingClientRect().top - chat.viewportTop() < -1)
			.at(-1);
		expect(expected).toBeDefined();
		chat.chat.scrollToPreviousMessage();
		await waitFor(
			() => expected instanceof Element && Math.abs(topOf(expected, chat) - ANCHOR_OFFSET) <= 2,
			{
				label: "previous user message reaches the anchor offset",
			}
		);
		expect(chat.chat.state.pinned).toBe(false);
	});
});

describe("composer clearance", () => {
	it("pads the column under a tall composer and shrinks back when the draft clears", async () => {
		const chat = createChat();
		chat.chat.setComposerHeight(300);
		chat.dom.flush();
		await frames(2);
		expect(chat.fixture.content.style.paddingBottom).toBe("324px");
		chat.chat.setComposerHeight(80);
		chat.dom.flush();
		await frames(2);
		expect(chat.fixture.content.style.paddingBottom).toBe(`${MIN_CLEARANCE_PX}px`);
	});

	it("clearance changes during fill are height-neutral: nothing moves", async () => {
		const chat = createChat();
		chat.chat.notifySend();
		chat.mountPair();
		await waitFor(() => chat.fixture.distance() <= ARRIVED, { label: "anchored" });
		await frames(2);
		const scrollHeight = chat.fixture.container.scrollHeight;
		const scrollTop = chat.fixture.scrollTop();
		// Composer grows by 40px of clearance: padding +40, reservation −40.
		chat.chat.setComposerHeight(MIN_CLEARANCE_PX + 16);
		chat.dom.flush();
		await frames(3);
		expect(chat.fixture.container.scrollHeight).toBe(scrollHeight);
		expect(chat.fixture.scrollTop()).toBe(scrollTop);
	});
});
