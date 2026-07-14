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

describe("in-turn content shrink (thinking-block collapse)", () => {
	it("a large mid-stream collapse keeps everything below it viewport-stable (no spacer re-inflation)", async () => {
		const chat = createChat({ turns: 3, viewportHeight: 600 });
		chat.chat.setStreaming(true);
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
		// spacer must NOT re-inflate (one-way while streaming) — the shrink
		// clamps instead, which keeps the content below the collapse stable.
		thinking.style.height = "28px";
		await frames(3);
		const after = topOf(answer, chat);
		expect(Math.abs(after - before)).toBeLessThanOrEqual(2);
		expect(chat.chat.state.pinned).toBe(true);
	});

	it("a post-stream collapse re-inflates the spacer instead: constant scrollHeight, zero motion", async () => {
		const chat = createChat({ turns: 3, viewportHeight: 600 });
		chat.chat.setStreaming(true);
		chat.chat.armSend();
		const { assistant: thinking } = chat.mountPair();
		await waitFor(() => chat.fixture.distance() <= ARRIVED, { label: "send anchored" });
		// Streams within the fill slack (the capped thinking viewport in the
		// app), so the spacer shrinks 1:1 and never floors.
		thinking.style.height = "240px";
		await frames(3);

		// Stream ends; the trailing think block auto-collapses in the same
		// breath (think-only reply). Re-inflation absorbs the shrink exactly.
		chat.chat.setStreaming(false);
		const scrollTopBefore = chat.fixture.scrollTop();
		const headerBefore = topOf(thinking, chat);
		thinking.style.height = "28px";
		await frames(3);
		expect(chat.fixture.scrollTop()).toBe(scrollTopBefore);
		expect(topOf(thinking, chat)).toBe(headerBefore);
	});

	it("a container resize mid-turn re-derives the anchor geometry (mobile keyboard close)", async () => {
		const chat = createChat({ turns: 3, viewportHeight: 400 });
		chat.chat.setStreaming(true);
		chat.chat.armSend();
		const { user, assistant } = chat.mountPair();
		await waitFor(() => Math.abs(topOf(user, chat) - ANCHOR_OFFSET) <= 2, { label: "anchored" });
		// A short reply streams in while the anchor holds.
		assistant.style.height = "40px";
		await frames(3);
		const spacerBefore = parseFloat(chat.fixture.spacer.style.height);

		// The virtual keyboard closes: the container gets ~40% taller. The
		// spacer must re-inflate for the new viewport even mid-stream (a frozen
		// spacer would leave the anchored message stranded mid-screen).
		chat.fixture.container.style.height = "560px";
		await waitFor(() => Math.abs(topOf(user, chat) - ANCHOR_OFFSET) <= 2, {
			label: "re-anchored after viewport growth",
		});
		expect(parseFloat(chat.fixture.spacer.style.height)).toBeGreaterThan(spacerBefore);
		expect(chat.chat.state.pinned).toBe(true);
	});
});

describe("manual scroll anchoring (Safari: no overflow-anchor)", () => {
	/** Simulated-Safari chat: native anchoring forced off (inline style loses
	 * to !important), manual anchoring forced on. WebKit itself cannot launch
	 * in this container; the missing native anchoring is the only engine
	 * difference relevant to this bug class. */
	function createManualChat(build: (fixture: Fixture) => void): ChatFixture {
		const style = document.createElement("style");
		style.textContent = ".sim-safari { overflow-anchor: none !important; }";
		document.head.appendChild(style);

		const fixture = createFixture({ viewportHeight: 400, blocks: [] });
		fixture.container.classList.add("sim-safari");
		const chat = createChatScroll({ forceManualAnchoring: true });
		build(fixture);
		const spacerAction = chat.attachSpacer(fixture.spacer);
		const containerAction = chat.attach(fixture.container, { content: () => fixture.content });
		chat.sync({ conversationKey: "c1", messages: [], lastMessageEmpty: false });
		const api: ChatFixture = {
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
		};
		active.push(api);
		return api;
	}

	/** Scroll up until `el` sits at the viewport top, and let the scroll event
	 * process so the read anchor is captured from a settled position. */
	async function readAt(chat: ChatFixture, el: Element) {
		const target = el.getBoundingClientRect().top - chat.viewportTop() + chat.fixture.scrollTop();
		dragScrollbarTo(chat.fixture.container, target);
		await frames(2);
		await nextTask();
		expect(chat.chat.state.pinned).toBe(false);
	}

	it("keeps a detached reader stable through an above-viewport collapse", async () => {
		let earlier!: HTMLDivElement;
		let reading!: HTMLDivElement;
		const chat = createManualChat((fixture) => {
			earlier = fixture.addBlock(400, { id: "earlier" }); // reasoning of an earlier turn
			reading = fixture.addBlock(300, { user: true, id: "reading" });
			fixture.addBlock(900, { id: "tail" });
		});
		await waitFor(() => chat.fixture.distance() <= ARRIVED, { label: "settle" });
		await nextTask();

		await readAt(chat, reading);
		const before = topOf(reading, chat);

		// The earlier thinking block collapses ABOVE the viewport: without
		// compensation this shifts the reading position by the full 350px.
		earlier.style.height = "50px";
		await frames(3);
		expect(Math.abs(topOf(reading, chat) - before)).toBeLessThanOrEqual(2);
	});

	it("tracks a descendant INSIDE a long message, not just the wrapper", async () => {
		// Reading the middle of one long assistant message whose own thinking
		// block collapses above the reading position: the wrapper's top never
		// moves, so a wrapper-level anchor would read delta 0 and let the text
		// jump — the anchor must be the descendant at the viewport top.
		const mkInner = (height: number) => {
			const el = document.createElement("div");
			el.style.cssText = `height: ${height}px; flex-shrink: 0; background: #eef;`;
			return el;
		};
		let thinking!: HTMLDivElement;
		let reading!: HTMLDivElement;
		const chat = createManualChat((fixture) => {
			const message = document.createElement("div");
			message.style.cssText = "display: flex; flex-direction: column; flex-shrink: 0;";
			message.dataset.messageId = "long-message";
			thinking = mkInner(400);
			reading = mkInner(300);
			message.append(thinking, reading, mkInner(900));
			fixture.content.appendChild(message);
		});
		await waitFor(() => chat.fixture.distance() <= ARRIVED, { label: "settle" });
		await nextTask();

		await readAt(chat, reading);
		const before = topOf(reading, chat);

		thinking.style.height = "50px"; // collapse INSIDE the same message
		await frames(3);
		expect(Math.abs(topOf(reading, chat) - before)).toBeLessThanOrEqual(2);
	});

	it("survives the anchored node being replaced (markdown re-render)", async () => {
		const mkInner = (height: number) => {
			const el = document.createElement("div");
			el.style.cssText = `height: ${height}px; flex-shrink: 0; background: #efe;`;
			return el;
		};
		let earlier!: HTMLDivElement;
		let reading!: HTMLDivElement;
		const chat = createManualChat((fixture) => {
			earlier = fixture.addBlock(400, { id: "earlier" });
			const message = document.createElement("div");
			message.style.cssText = "display: flex; flex-direction: column; flex-shrink: 0;";
			message.dataset.messageId = "rendered-message";
			reading = mkInner(300);
			message.append(reading, mkInner(900));
			fixture.content.appendChild(message);
		});
		await waitFor(() => chat.fixture.distance() <= ARRIVED, { label: "settle" });
		await nextTask();

		await readAt(chat, reading);
		const containerTop = chat.viewportTop();
		const before = reading.getBoundingClientRect().top - containerTop;

		// A worker markdown swap REPLACES the anchored paragraph in the same
		// pass as an above-viewport shrink: the dead node must not silence
		// compensation (fall back to the surviving message wrapper).
		const replacement = mkInner(300);
		reading.replaceWith(replacement);
		reading = replacement;
		earlier.style.height = "50px";
		await frames(3);
		let position = reading.getBoundingClientRect().top - containerTop;
		expect(Math.abs(position - before)).toBeLessThanOrEqual(2);

		// And the anchor was re-resolved onto live nodes: a LATER above-viewport
		// change is compensated too (a stale chain would let this one jump).
		earlier.style.height = "10px";
		await frames(3);
		position = reading.getBoundingClientRect().top - containerTop;
		expect(Math.abs(position - before)).toBeLessThanOrEqual(2);
	});

	it("never cancels a user scroll pending in the same pass as a shrink", async () => {
		let earlier!: HTMLDivElement;
		let reading!: HTMLDivElement;
		const chat = createManualChat((fixture) => {
			earlier = fixture.addBlock(400, { id: "earlier" });
			reading = fixture.addBlock(300, { user: true, id: "reading" });
			fixture.addBlock(900, { id: "tail" });
		});
		await waitFor(() => chat.fixture.distance() <= ARRIVED, { label: "settle" });
		await nextTask();
		await readAt(chat, reading);

		// A user scroll AND an above-viewport shrink land in the same task —
		// the resize pass can run BEFORE the scroll event is processed, so the
		// captured anchor is stale (it includes the unprocessed movement).
		// Compensating from it would yank the view away from where the user
		// just scrolled; the pass must be skipped instead.
		const userTarget = chat.fixture.scrollTop() - 120;
		dragScrollbarTo(chat.fixture.container, userTarget);
		earlier.style.height = "250px";
		await frames(3);
		expect(Math.abs(chat.fixture.scrollTop() - userTarget)).toBeLessThanOrEqual(2);
		expect(chat.chat.state.pinned).toBe(false);
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
