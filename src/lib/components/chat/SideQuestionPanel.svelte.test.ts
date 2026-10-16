import SideQuestionPanel from "./SideQuestionPanel.svelte";
import { render } from "vitest-browser-svelte";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { flushSync } from "svelte";

let sent: Array<{ url: string; body: Record<string, unknown>; signal?: AbortSignal | null }>;
let respond: () => Response;

beforeEach(() => {
	sent = [];
	respond = () => new Response("", { status: 200 });
	vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
		sent.push({ url: String(url), body: JSON.parse(String(init?.body)), signal: init?.signal });
		return respond();
	});
});

afterEach(() => vi.unstubAllGlobals());

function controlledStream() {
	const encoder = new TextEncoder();
	let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
	const stream = new ReadableStream<Uint8Array>({
		start(c) {
			controller = c;
		},
	});
	return {
		stream,
		push: (text: string) => controller?.enqueue(encoder.encode(text)),
		close: () => controller?.close(),
	};
}

// the library types component as the constructor, at runtime it is the mount exports
const mount = () => {
	const result = render(SideQuestionPanel, { conversationId: "abc" });
	return {
		...result,
		component: result.component as unknown as ReturnType<typeof SideQuestionPanel>,
	};
};

const dismissButton = (baseElement: HTMLElement) =>
	baseElement.querySelector<HTMLButtonElement>('button[aria-label="Dismiss side question"]') ??
	undefined;

const cards = (baseElement: HTMLElement) =>
	baseElement.querySelectorAll('section[aria-label="Side question"]');

describe("side question panel", () => {
	it("lets ordinary messages through and renders nothing", () => {
		const { component, baseElement } = mount();

		expect(component.intercept("what is the loss?")).toBe(false);
		expect(component.intercept("/btwhat")).toBe(false);
		expect(sent).toHaveLength(0);
		expect(cards(baseElement)).toHaveLength(0);
	});

	it("answers a bare /btw with a hint instead of asking anything", async () => {
		const { component, baseElement } = mount();

		expect(component.intercept("  /btw  ")).toBe(true);
		expect(sent).toHaveLength(0);
		await expect.poll(() => cards(baseElement)).toHaveLength(1);
		expect(cards(baseElement)[0].textContent).toContain("Type your question after /btw");
	});

	it("posts the question and renders the answer as it streams", async () => {
		const body = controlledStream();
		respond = () => new Response(body.stream, { status: 200 });
		const { component, baseElement } = mount();

		expect(component.intercept("/btw what is the loss?")).toBe(true);
		flushSync();

		await vi.waitFor(() => expect(sent).toHaveLength(1));
		expect(sent[0].url).toMatch(/\/conversation\/abc\/btw$/);
		expect(sent[0].body).toEqual({ question: "what is the loss?" });
		expect(baseElement.textContent).toContain("what is the loss?");
		expect(baseElement.textContent).toContain("Thinking");
		expect(baseElement.textContent).toContain("Only you see this.");

		body.push("The loss is ");
		await vi.waitFor(() => expect(baseElement.textContent).toContain("The loss is"));
		expect(baseElement.textContent).not.toContain("Thinking");

		body.push("0.42.");
		body.close();
		await vi.waitFor(() => expect(baseElement.textContent).toContain("The loss is 0.42."));
	});

	it("removes the card and aborts its request when dismissed", async () => {
		const body = controlledStream();
		respond = () => new Response(body.stream, { status: 200 });
		const { component, baseElement } = mount();

		component.intercept("/btw still training?");
		flushSync();
		await vi.waitFor(() => expect(sent).toHaveLength(1));

		dismissButton(baseElement)?.click();

		await vi.waitFor(() => expect(cards(baseElement)).toHaveLength(0));
		expect(sent[0].signal?.aborted).toBe(true);
		expect(baseElement.textContent).not.toContain("Could not answer");
	});

	it("shows the server's message when the request fails", async () => {
		respond = () =>
			new Response(JSON.stringify({ message: "The model is unavailable" }), {
				status: 502,
				headers: { "Content-Type": "application/json" },
			});
		const { component, baseElement } = mount();

		component.intercept("/btw what is the loss?");

		await vi.waitFor(() => expect(baseElement.textContent).toContain("The model is unavailable"));
		expect(cards(baseElement)).toHaveLength(1);
	});

	it("keeps only the three newest questions", async () => {
		respond = () => new Response(controlledStream().stream, { status: 200 });
		const { component, baseElement } = mount();

		for (const n of [1, 2, 3, 4]) component.intercept(`/btw question ${n}`);
		flushSync();

		await vi.waitFor(() => expect(sent).toHaveLength(4));
		expect(cards(baseElement)).toHaveLength(3);
		expect(baseElement.textContent).not.toContain("question 1");
		expect(sent[0].signal?.aborted).toBe(true);
		expect(sent[3].signal?.aborted).toBe(false);
	});
});
