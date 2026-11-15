/**
 * The question panel on a small phone, in the real ChatWindow: it sits in the composer overlay,
 * outside the chat's only scroller, on a page that never scrolls — so whatever does not fit
 * here cannot be reached at all.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page as browserPage } from "@vitest/browser/context";
import ChatWindowShell from "$lib/components/__tests__/ChatWindowShell.svelte";
import { renderWithApp } from "$lib/components/__tests__/renderWithApp";
import { registerQuestion, unregisterQuestion } from "$lib/stores/pendingQuestion";
import type { ElicitationRequestPayload } from "$lib/types/McpElicitation";
import type { Message } from "$lib/types/Message";
import type { Model } from "$lib/types/Model";

// Read at import by the MCP store ChatWindow pulls in; SvelteKit only fills it in a running app.
vi.mock("$env/dynamic/public", () => ({ env: {} }));

const PHONE = { width: 375, height: 667 };
const CAP = 0.6;
const CONVERSATION_ID = "conv-1";

// Lengths from the 2026-09-18 repro: a 185-character question, descriptions past the old 200.
const QUESTION =
	"Before I launch the fine-tuning job, which evaluation should I use to decide whether " +
	"the new checkpoint is actually better than the base model on your support-ticket data?";
const description = (what: string) =>
	`${what} — quick to set up and cheap to run, but it only tells you about the categories ` +
	"you already have plenty of labelled examples for, so rare categories will look noisy " +
	"and the comparison may flatter whichever model saw more of the common ones in training.";

const request: ElicitationRequestPayload = {
	elicitationId: "11111111-1111-4111-8111-111111111111",
	source: "assistant",
	server: "",
	mode: "form",
	message: QUESTION,
	fields: [
		{
			kind: "select",
			name: "q1",
			title: "Evaluation",
			description: QUESTION,
			required: true,
			multiple: false,
			allowOther: true,
			options: ["Held-out split", "LLM judge", "Human spot-check"].map((label) => ({
				value: label,
				label,
				description: description(label),
			})),
		},
	],
};

const model = {
	id: "test/model",
	name: "test/model",
	displayName: "Test model",
	preprompt: "",
	multimodal: false,
	unlisted: false,
	hasInferenceAPI: false,
} as Model;

const messages: Message[] = Array.from({ length: 12 }, (_, i) => ({
	id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
	from: i % 2 === 0 ? "user" : "assistant",
	content:
		`Message ${i + 1}. ` + "A paragraph of earlier conversation to scroll through. ".repeat(8),
	ancestors: Array.from(
		{ length: i },
		(_, j) => `00000000-0000-4000-8000-${String(j).padStart(12, "0")}`
	),
	children: i < 11 ? [`00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`] : [],
}));

const mount = () => {
	registerQuestion(CONVERSATION_ID, request);
	return renderWithApp(
		ChatWindowShell,
		{ messages, currentModel: model, models: [model] },
		{
			page: {
				url: `/conversation/${CONVERSATION_ID}`,
				params: { id: CONVERSATION_ID },
				route: { id: "/conversation/[id]" },
			},
		}
	);
};

const panelIn = (el: HTMLElement) => {
	const panel = el.querySelector<HTMLElement>('[aria-label="Question from the assistant"]');
	if (!panel) throw new Error("the question panel did not render");
	return panel;
};
const scrollerIn = (el: HTMLElement) => {
	const scroller = el.querySelector<HTMLElement>('[aria-label="Conversation messages"]');
	if (!scroller) throw new Error("the chat scroller did not render");
	return scroller;
};
const buttonIn = (el: HTMLElement, label: string) => {
	const found = [...el.querySelectorAll("button")].find(
		(b) => (b.textContent ?? "").trim() === label || b.getAttribute("aria-label") === label
	);
	if (!found) throw new Error(`no "${label}" button`);
	return found;
};

/** On screen and on top: what a tap at its centre would land on. */
const reachable = (el: Element, height = window.innerHeight) => {
	const box = el.getBoundingClientRect();
	const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
	return box.top >= 0 && box.bottom <= height && hit !== null && el.contains(hit);
};

beforeEach(async () => {
	// ChatWindow refreshes the MCP server list on mount; nothing here needs a live server.
	vi.stubGlobal("fetch", async () => new Response("[]", { status: 200 }));
	await browserPage.viewport(PHONE.width, PHONE.height);
});

afterEach(async () => {
	unregisterQuestion(request.elicitationId);
	vi.unstubAllGlobals();
	await browserPage.viewport(414, 896);
});

describe("the question panel on a 375×667 phone", () => {
	it("keeps the question, its options and Send on screen, within its cap", async () => {
		const { baseElement } = mount();
		const panel = panelIn(baseElement);
		const question = panel.querySelector("p");
		if (!question) throw new Error("no question text");

		await vi.waitFor(() => expect(question.textContent).toContain(QUESTION));
		expect(panel.getBoundingClientRect().top).toBeGreaterThanOrEqual(0);
		expect(panel.getBoundingClientRect().height).toBeLessThanOrEqual(PHONE.height * CAP + 1);
		expect(reachable(question)).toBe(true);
		expect(reachable(buttonIn(panel, "Send"))).toBe(true);
		expect(reachable(buttonIn(panel, "Skip"))).toBe(true);

		// What does not fit scrolls inside the panel, where a touch on it can reach it.
		const options = panel.querySelector<HTMLElement>('[data-testid="ask-options"]');
		if (!options) throw new Error("no options list");
		expect(options.scrollHeight).toBeGreaterThan(options.clientHeight);
		const last = [...options.querySelectorAll("button")].at(-1);
		last?.scrollIntoView({ block: "nearest" });
		expect(last && reachable(last)).toBe(true);
		expect(reachable(question)).toBe(true);
	});

	it("leaves the chat behind it reachable and scrollable", async () => {
		const { baseElement } = mount();
		const panel = panelIn(baseElement);
		const scroller = scrollerIn(baseElement);

		const strip = panel.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
		expect(strip).toBeGreaterThan(0);
		const hit = document.elementFromPoint(
			PHONE.width / 2,
			scroller.getBoundingClientRect().top + strip / 2
		);
		expect(hit && scroller.contains(hit)).toBe(true);

		await vi.waitFor(() => expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight));
		const before = scroller.scrollTop;
		scroller.scrollTop = 0;
		expect(scroller.scrollTop).toBeLessThan(before);
	});

	it("collapses to one line that gives the chat back, and reopens", async () => {
		const { baseElement } = mount();
		const panel = panelIn(baseElement);
		const scroller = scrollerIn(baseElement);
		const openTop = panel.getBoundingClientRect().top;

		buttonIn(panel, "Collapse question").click();
		await vi.waitFor(() => expect(panel.getBoundingClientRect().height).toBeLessThan(56));
		// Most of the panel's height goes back to the chat.
		expect(panel.getBoundingClientRect().top - openTop).toBeGreaterThan(PHONE.height * 0.3);
		const hit = document.elementFromPoint(PHONE.width / 2, panel.getBoundingClientRect().top - 40);
		expect(hit && scroller.contains(hit)).toBe(true);

		const reopen = panel.querySelector<HTMLButtonElement>('button[aria-expanded="false"]');
		expect(reopen?.textContent).toContain("Question waiting");
		reopen?.click();
		await vi.waitFor(() => expect(panel.getBoundingClientRect().top).toBeCloseTo(openTop, 0));
		const question = panel.querySelector("p");
		expect(question && reachable(question)).toBe(true);
	});
});

describe("typing an answer with the on-screen keyboard up", () => {
	const typeOwnAnswer = async (baseElement: HTMLElement) => {
		const panel = panelIn(baseElement);
		buttonIn(panel, "Something else…").click();
		await vi.waitFor(() => expect(panel.querySelector("input")).not.toBeNull());
		const input = panel.querySelector("input");
		if (!input) throw new Error("no input");
		input.focus();
		return { panel, input };
	};

	it("fits when the keyboard shrinks only the visual viewport, as on iOS", async () => {
		const visible = 367;
		const viewport = window.visualViewport;
		if (!viewport) throw new Error("no visualViewport");
		Object.defineProperty(viewport, "height", { configurable: true, get: () => visible });
		try {
			const { baseElement } = mount();
			viewport.dispatchEvent(new Event("resize"));
			const { panel, input } = await typeOwnAnswer(baseElement);

			await vi.waitFor(() =>
				expect(panel.getBoundingClientRect().height).toBeLessThanOrEqual(visible * CAP + 1)
			);
			// Panel and composer together fit the visible strip, so the browser can bring the
			// focused box, the question above it and Send below it into view at once.
			expect(PHONE.height - panel.getBoundingClientRect().top).toBeLessThanOrEqual(visible);
			const options = panel.querySelector<HTMLElement>('[data-testid="ask-options"]');
			const inputBox = input.getBoundingClientRect();
			const optionsBox = options?.getBoundingClientRect();
			expect(inputBox.top).toBeGreaterThanOrEqual(optionsBox?.top ?? Infinity);
			expect(inputBox.bottom).toBeLessThanOrEqual(optionsBox?.bottom ?? -Infinity);
		} finally {
			Reflect.deleteProperty(viewport, "height");
		}
	});

	it("fits when the keyboard shrinks the whole viewport, as on Android", async () => {
		const { baseElement } = mount();
		const visible = 367;
		await browserPage.viewport(PHONE.width, visible);
		const { panel, input } = await typeOwnAnswer(baseElement);

		await vi.waitFor(() =>
			expect(panel.getBoundingClientRect().height).toBeLessThanOrEqual(visible * CAP + 1)
		);
		const question = panel.querySelector("p");
		expect(question && reachable(question, visible)).toBe(true);
		expect(reachable(input, visible)).toBe(true);
		expect(reachable(buttonIn(panel, "Send"), visible)).toBe(true);
	});
});
