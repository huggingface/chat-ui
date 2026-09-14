import TurnWaitBanner from "./TurnWaitBanner.svelte";
import { render } from "vitest-browser-svelte";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

/** The wake is a POST, so what reaches the server is the assertion worth making. */
let sent: Array<{ url: string; body: Record<string, unknown> }>;
let respond: () => Response;

beforeEach(() => {
	sent = [];
	respond = () => new Response(JSON.stringify({ ok: true }), { status: 200 });
	vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
		sent.push({ url: String(url), body: JSON.parse(String(init?.body)) });
		return respond();
	});
});

afterEach(() => vi.unstubAllGlobals());

const mount = (over: Record<string, unknown> = {}) =>
	render(TurnWaitBanner, {
		until: Date.now() + 120_000,
		reason: "the training job",
		conversationId: "conv-1",
		messageId: "msg-1",
		canWake: true,
		...over,
	} as never);

/** Icon-only, so its accessible name is the only handle on it. */
const wakeButton = (baseElement: HTMLElement) =>
	baseElement.querySelector<HTMLButtonElement>('button[aria-label="Check now"]') ?? undefined;

describe("the wait pill", () => {
	it("counts down to the deadline", () => {
		expect(mount().baseElement.textContent).toContain("resumes in");
	});

	it("asks the server to cut the wait short when the user checks now", async () => {
		const { baseElement } = mount();

		wakeButton(baseElement)?.click();

		await vi.waitFor(() => expect(sent).toHaveLength(1));
		expect(sent[0].url).toContain("/conversation/conv-1/wake");
		expect(sent[0].body).toEqual({ messageId: "msg-1" });
	});

	it("stops counting down once the wake is accepted", async () => {
		const { baseElement } = mount();

		wakeButton(baseElement)?.click();

		// The countdown would keep ticking against a deadline that no longer
		// decides anything; the resumed turn's own output replaces the pill.
		await vi.waitFor(() => expect(baseElement.textContent).toContain("checking now"));
		expect(baseElement.textContent).not.toContain("resumes in");
		expect(wakeButton(baseElement)).toBeUndefined();
	});

	it("puts the countdown back when the request fails, since the timer still stands", async () => {
		respond = () => new Response("{}", { status: 500 });
		const { baseElement } = mount();

		wakeButton(baseElement)?.click();

		await vi.waitFor(() => expect(baseElement.textContent).toContain("Couldn't check early"));
		expect(baseElement.textContent).toContain("resumes in");
		expect(wakeButton(baseElement)).toBeDefined();
	});

	it("offers no wake on a read-only view of someone else's chat", () => {
		expect(wakeButton(mount({ canWake: false }).baseElement)).toBeUndefined();
	});

	it("offers no wake once the deadline is long past and a sweep owns the turn", () => {
		const { baseElement } = mount({ until: Date.now() - 60_000 });
		expect(baseElement.textContent).toContain("overdue");
		expect(wakeButton(baseElement)).toBeUndefined();
	});
});
