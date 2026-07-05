import { afterEach, describe, expect, it, vi } from "vitest";
import { createChatScroll } from "../chatScroll.svelte";
import { MIN_SPACER_FALLBACK_PX } from "../spacer";
import {
	createFixture,
	dragScrollbarTo,
	frame,
	frames,
	nextTask,
	startClsProbe,
	waitFor,
	wheel,
	type Fixture,
} from "./harness";

const ARRIVED = 2;
const ANCHOR_OFFSET = 50;

interface ChatFixture {
	fixture: Fixture;
	chat: ReturnType<typeof createChatScroll>;
	messages: { id: string; from: "user" | "assistant" }[];
	sync: (lastMessageEmpty?: boolean, conversationKey?: string) => void;
	/** Mount a (user, assistant) pair — what a send/edit produces. */
	mountPair: (
		userHeight?: number,
		opts?: { empty?: boolean }
	) => { user: HTMLDivElement; assistant: HTMLDivElement };
	/** Swap the trailing assistant for a fresh empty sibling — a regenerate. */
	swapAssistant: () => HTMLDivElement;
	viewportTop: () => number;
	destroy: () => void;
}

let active: ChatFixture[] = [];
afterEach(() => {
	for (const c of active) c.destroy();
	active = [];
	vi.useRealTimers();
});

function createChat({ turns = 3, viewportHeight = 400 } = {}): ChatFixture {
	const fixture = createFixture({ viewportHeight, blocks: [] });
	const chat = createChatScroll();
	const messages: ChatFixture["messages"] = [];
	let n = 0;

	const addTurn = (userHeight = 60, assistantHeight = 220) => {
		const userId = `u${++n}`;
		const assistantId = `a${n}`;
		fixture.addBlock(userHeight, { user: true, id: userId });
		fixture.addBlock(assistantHeight, { id: assistantId });
		messages.push({ id: userId, from: "user" }, { id: assistantId, from: "assistant" });
	};
	for (let i = 0; i < turns; i++) addTurn();

	// Child action first, parent action second — matches Svelte's bottom-up
	// mount order in ChatWindow (spacer height exists before the initial jump).
	const spacerAction = chat.attachSpacer(fixture.spacer);
	const containerAction = chat.attach(fixture.container, { content: () => fixture.content });

	const api: ChatFixture = {
		fixture,
		chat,
		messages,
		sync(lastMessageEmpty = false, conversationKey = "c1") {
			chat.sync({ conversationKey, messages: [...messages], lastMessageEmpty });
		},
		mountPair(userHeight = 40, { empty = true } = {}) {
			const userId = `u${++n}`;
			const assistantId = `a${n}`;
			// Non-empty pairs stay short enough that the computed spacer remains
			// above its floor — the assertions distinguish floor from anchor.
			const user = fixture.addBlock(userHeight, { user: true, id: userId });
			const assistant = fixture.addBlock(empty ? 0 : 60, { id: assistantId });
			messages.push({ id: userId, from: "user" }, { id: assistantId, from: "assistant" });
			api.sync(empty);
			return { user, assistant };
		},
		swapAssistant() {
			fixture.removeLast();
			messages.pop();
			const assistantId = `a${++n}`;
			const assistant = fixture.addBlock(0, { id: assistantId });
			messages.push({ id: assistantId, from: "assistant" });
			api.sync(true);
			return assistant;
		},
		viewportTop: () => fixture.container.getBoundingClientRect().top,
		destroy() {
			containerAction.destroy();
			spacerAction.destroy();
			fixture.destroy();
		},
	};
	api.sync();
	active.push(api);
	return api;
}

function topOf(el: Element, chat: ChatFixture): number {
	return el.getBoundingClientRect().top - chat.viewportTop();
}

describe("send anchoring", () => {
	it("anchors the sent message ~50px below the viewport top", async () => {
		const chat = createChat();
		chat.chat.armSend();
		const { user } = chat.mountPair();
		await waitFor(() => Math.abs(topOf(user, chat) - ANCHOR_OFFSET) <= 2, {
			label: "user message glides to the anchor offset",
		});
		expect(chat.fixture.distance()).toBeLessThanOrEqual(ARRIVED); // pinned at bottom
	});

	it("fill phase: constant scrollHeight, zero scroll movement, zero layout shift", async () => {
		const chat = createChat();
		chat.chat.armSend();
		const { user, assistant } = chat.mountPair();
		await waitFor(() => Math.abs(topOf(user, chat) - ANCHOR_OFFSET) <= 2, { label: "anchored" });
		await frames(3); // let everything paint before probing
		const probe = startClsProbe();
		const scrollHeightBefore = chat.fixture.container.scrollHeight;
		const scrollTopBefore = chat.fixture.scrollTop();
		// Stream 80px into a spacer with ~100px of slack above its floor.
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

	it("hands off seamlessly from fill to follow when the reply outgrows the viewport", async () => {
		const chat = createChat();
		chat.chat.armSend();
		const { assistant } = chat.mountPair();
		await waitFor(() => chat.fixture.distance() <= ARRIVED, { label: "anchored" });
		let maxFrameJump = 0;
		let prevTop = chat.fixture.scrollTop();
		for (let i = 0; i < 60; i++) {
			assistant.style.height = `${parseFloat(assistant.style.height) + 10}px`;
			await frame();
			const top = chat.fixture.scrollTop();
			maxFrameJump = Math.max(maxFrameJump, Math.abs(top - prevTop));
			expect(top).toBeGreaterThanOrEqual(prevTop); // never scrolls backward
			prevTop = top;
		}
		await waitFor(() => chat.fixture.distance() <= ARRIVED, { label: "follows to bottom" });
		expect(maxFrameJump).toBeLessThan(80); // glide, not teleport
	});

	it("first exchange pins without inflating the spacer", async () => {
		const chat = createChat({ turns: 0 });
		chat.chat.armSend();
		chat.mountPair();
		await frames(3);
		expect(parseFloat(chat.fixture.spacer.style.height)).toBe(MIN_SPACER_FALLBACK_PX);
		await waitFor(() => chat.fixture.distance() <= ARRIVED, { label: "pinned to bottom" });
	});

	it("spacer stays inflated after the stream ends (no end-of-turn jump)", async () => {
		const chat = createChat();
		chat.chat.armSend();
		const { assistant } = chat.mountPair();
		await waitFor(() => chat.fixture.distance() <= ARRIVED, { label: "anchored" });
		assistant.style.height = "60px"; // short reply, stream over
		await frames(4);
		const height = parseFloat(chat.fixture.spacer.style.height);
		expect(height).toBeGreaterThan(MIN_SPACER_FALLBACK_PX);
		const scrollTop = chat.fixture.scrollTop();
		await frames(10);
		expect(chat.fixture.scrollTop()).toBe(scrollTop);
		expect(parseFloat(chat.fixture.spacer.style.height)).toBe(height);
	});
});

describe("retry & branch intents", () => {
	it("regenerate from a scrolled-up position never moves the view", async () => {
		const chat = createChat({ turns: 5 });
		wheel(chat.fixture.container, -500);
		await frame();
		const scrollTop = chat.fixture.scrollTop();
		chat.chat.armRetry();
		chat.swapAssistant(); // old reply collapses, empty sibling mounts
		await frames(4);
		expect(chat.fixture.scrollTop()).toBe(scrollTop);
		expect(chat.chat.state.pinned).toBe(false);
	});

	it("regenerate at the bottom re-pins and re-anchors", async () => {
		const chat = createChat({ turns: 5 });
		chat.chat.armRetry();
		chat.swapAssistant();
		await frames(3);
		expect(chat.chat.state.pinned).toBe(true);
		await waitFor(() => chat.fixture.distance() <= ARRIVED, { label: "stays at bottom" });
		// Spacer re-inflated: the collapsed reply must not clamp-jump the view.
		expect(parseFloat(chat.fixture.spacer.style.height)).toBeGreaterThan(MIN_SPACER_FALLBACK_PX);
	});

	it("a path reassignment to an old branch leaf does not consume the intent", async () => {
		const chat = createChat({ turns: 4 });
		chat.chat.armSend();
		// Retry flows first flip the visible path: trailing becomes an OLD
		// assistant (known id, non-empty). The intent must survive this.
		chat.messages.pop();
		chat.messages.pop();
		chat.sync(false);
		await frames(2);
		expect(parseFloat(chat.fixture.spacer.style.height)).toBe(MIN_SPACER_FALLBACK_PX);
		// The real pair mounts afterwards — now it fires.
		chat.mountPair();
		await waitFor(() => chat.fixture.distance() <= ARRIVED, { label: "anchors the real pair" });
		expect(parseFloat(chat.fixture.spacer.style.height)).toBeGreaterThan(MIN_SPACER_FALLBACK_PX);
	});

	it("detaching while a send is in flight revokes the pin but keeps the anchor", async () => {
		const chat = createChat();
		chat.chat.armSend();
		wheel(chat.fixture.container, -300); // reads up while waiting
		await frame();
		const scrollTop = chat.fixture.scrollTop();
		chat.mountPair();
		await frames(4);
		expect(chat.chat.state.pinned).toBe(false);
		expect(chat.fixture.scrollTop()).toBe(scrollTop);
		expect(parseFloat(chat.fixture.spacer.style.height)).toBeGreaterThan(MIN_SPACER_FALLBACK_PX);
	});

	it("branch switch keeps the compared message stationary (shorter branch clamps, no teleport)", async () => {
		const chat = createChat({ turns: 6 });
		dragScrollbarTo(chat.fixture.container, 300);
		await frame();
		chat.chat.notifyBranchSwitch();
		// Shorter alternative: drop the last two turns.
		for (let i = 0; i < 4; i++) {
			chat.fixture.removeLast();
			chat.messages.pop();
		}
		chat.sync(false);
		await frames(4);
		expect(chat.chat.state.pinned).toBe(false);
		// Kept in place, clamped only if the shorter branch forces it.
		expect(chat.fixture.scrollTop()).toBe(Math.min(300, chat.fixture.maxScrollTop()));
	});

	it("a branch switch can never consume an armed intent, even onto an empty errored sibling", async () => {
		const chat = createChat({ turns: 4 });
		chat.chat.armSend();
		// Branch arrow lands on a sibling whose leaf is an assistant stopped
		// before its first token: unknown id + empty content — structurally
		// identical to a fresh pair, distinguishable only by the switch signal.
		chat.chat.notifyBranchSwitch();
		chat.fixture.removeLast();
		chat.messages.pop();
		const siblingId = "errored-sibling";
		chat.fixture.addBlock(0, { id: siblingId });
		chat.messages.push({ id: siblingId, from: "assistant" });
		chat.sync(true);
		await frames(3);
		expect(parseFloat(chat.fixture.spacer.style.height)).toBe(MIN_SPACER_FALLBACK_PX);
		// The real pair still anchors when it mounts (the programmatic unpin
		// from the branch switch must not have revoked the pin).
		chat.mountPair();
		await waitFor(() => chat.fixture.distance() <= ARRIVED, { label: "real pair anchors" });
		expect(chat.chat.state.pinned).toBe(true);
		expect(parseFloat(chat.fixture.spacer.style.height)).toBeGreaterThan(MIN_SPACER_FALLBACK_PX);
	});

	it("send still anchors when the first token lands in the same flush as the pair", async () => {
		const chat = createChat();
		chat.chat.armSend();
		// The pair mounts already carrying content (non-empty), but the exact
		// +2 growth identifies it as the awaited send.
		chat.mountPair(40, { empty: false });
		await waitFor(() => chat.fixture.distance() <= ARRIVED, { label: "anchored" });
		expect(chat.chat.state.pinned).toBe(true);
		expect(parseFloat(chat.fixture.spacer.style.height)).toBeGreaterThan(MIN_SPACER_FALLBACK_PX);
	});

	it("an expired intent never fires", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		const chat = createChat();
		wheel(chat.fixture.container, -300);
		await frame();
		chat.chat.armSend();
		vi.setSystemTime(Date.now() + 61_000);
		chat.mountPair();
		await frames(3);
		// Discarded outright: no spacer, no pin.
		expect(parseFloat(chat.fixture.spacer.style.height)).toBe(MIN_SPACER_FALLBACK_PX);
		expect(chat.chat.state.pinned).toBe(false);
	});
});

describe("conversation switch", () => {
	it("resets instantly: bottom, pinned, spacer back to floor", async () => {
		const chat = createChat({ turns: 5 });
		chat.chat.armSend();
		chat.mountPair();
		await waitFor(() => chat.fixture.distance() <= ARRIVED, { label: "anchored" });
		wheel(chat.fixture.container, -400);
		await frame();
		chat.sync(false, "c2");
		await frame();
		expect(chat.chat.state.pinned).toBe(true);
		expect(chat.fixture.distance()).toBeLessThanOrEqual(ARRIVED);
		expect(parseFloat(chat.fixture.spacer.style.height)).toBe(MIN_SPACER_FALLBACK_PX);
	});
});

describe("floating buttons", () => {
	it("stay hidden while pinned — including during the send glide — and follow show/hide hysteresis", async () => {
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
		await waitFor(() => Math.abs(topOf(expected as Element, chat) - ANCHOR_OFFSET) <= 2, {
			label: "previous user message reaches the anchor offset",
		});
		expect(chat.chat.state.pinned).toBe(false);
	});
});

describe("thinking-block collapse (layout-shift regressions)", () => {
	it("a large in-turn collapse keeps everything below it viewport-stable (no spacer re-inflation)", async () => {
		const chat = createChat({ turns: 3, viewportHeight: 600 });
		chat.chat.armSend();
		const { assistant: thinking } = chat.mountPair();
		await waitFor(() => chat.fixture.distance() <= ARRIVED, { label: "send anchored" });

		// Thinking streams: the block grows well past the fill slack, so the
		// spacer floors and real following takes over.
		for (let i = 0; i < 16; i++) {
			thinking.style.height = `${parseFloat(thinking.style.height) + 20}px`;
			await frame();
		}
		const answer = chat.fixture.addBlock(24, { id: "answer" });
		await waitFor(() => chat.fixture.distance() <= ARRIVED, { label: "settled while pinned" });

		const before = topOf(answer, chat);
		// Answer starts: the reasoning block collapses ~300px in one frame. The
		// spacer must NOT re-inflate (monotonic within the turn) — the shrink
		// clamps instead, which keeps the content below the collapse stable.
		thinking.style.height = "28px";
		await frames(3);
		const after = topOf(answer, chat);
		expect(Math.abs(after - before)).toBeLessThanOrEqual(2);
		expect(chat.chat.state.pinned).toBe(true);
	});

	it("manual anchoring (Safari: no overflow-anchor) keeps a detached reader stable through an above-viewport collapse", async () => {
		// Simulate Safari: native anchoring can never engage, whatever the
		// controller sets (inline style loses to !important).
		const style = document.createElement("style");
		style.textContent = ".sim-safari { overflow-anchor: none !important; }";
		document.head.appendChild(style);

		const fixture = createFixture({ viewportHeight: 400, blocks: [] });
		fixture.container.classList.add("sim-safari");
		const chat = createChatScroll({ forceManualAnchoring: true });
		const earlier = fixture.addBlock(400, { id: "earlier" }); // reasoning of an earlier part
		const reading = fixture.addBlock(300, { user: true, id: "reading" });
		fixture.addBlock(900, { id: "tail" });
		const spacerAction = chat.attachSpacer(fixture.spacer);
		const containerAction = chat.attach(fixture.container, { content: () => fixture.content });
		chat.sync({
			conversationKey: "c1",
			messages: [{ id: "reading", from: "user" }],
			lastMessageEmpty: false,
		});
		active.push({
			fixture,
			chat,
			messages: [],
			sync: () => {},
			mountPair: () => ({
				user: document.createElement("div"),
				assistant: document.createElement("div"),
			}),
			swapAssistant: () => document.createElement("div"),
			viewportTop: () => fixture.container.getBoundingClientRect().top,
			destroy() {
				containerAction.destroy();
				spacerAction.destroy();
				fixture.destroy();
				style.remove();
			},
		});
		await waitFor(() => fixture.distance() <= ARRIVED, { label: "settle" });
		await nextTask();

		// Scroll up to read the middle block (detached).
		const containerTop = fixture.container.getBoundingClientRect().top;
		const target = reading.getBoundingClientRect().top - containerTop + fixture.container.scrollTop;
		dragScrollbarTo(fixture.container, target);
		await frames(2);
		expect(chat.state.pinned).toBe(false);
		const before = reading.getBoundingClientRect().top - containerTop;

		// The earlier thinking block collapses ABOVE the viewport: without
		// compensation this shifts the reading position by the full 350px.
		earlier.style.height = "50px";
		await frames(3);
		const after = reading.getBoundingClientRect().top - containerTop;
		expect(Math.abs(after - before)).toBeLessThanOrEqual(2);
	});
});

describe("composer clearance", () => {
	it("grows the spacer floor under a tall composer and shrinks it back", async () => {
		const chat = createChat();
		chat.chat.setComposerHeight(300);
		await frames(2);
		expect(parseFloat(chat.fixture.spacer.style.height)).toBe(324);
		chat.chat.setComposerHeight(80);
		await frames(2);
		expect(parseFloat(chat.fixture.spacer.style.height)).toBe(MIN_SPACER_FALLBACK_PX);
	});
});
