import AskQuestion from "./AskQuestion.svelte";
import { render } from "vitest-browser-svelte";
import { userEvent } from "@vitest/browser/context";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import type { ElicitationField, ElicitationRequestPayload } from "$lib/types/McpElicitation";
import {
	pendingQuestions,
	registerQuestion,
	unregisterQuestion,
} from "$lib/stores/pendingQuestion";
import { elicitationToResume } from "$lib/stores/elicitationResume";
import { get } from "svelte/store";

let sent: Array<Record<string, unknown>>;

beforeEach(() => {
	sent = [];
	vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
		sent.push(JSON.parse(String(init?.body)));
		return new Response(JSON.stringify({ ok: true, resume: true }), { status: 200 });
	});
});

afterEach(() => vi.unstubAllGlobals());

const ask = (name: string, question: string, over: Partial<ElicitationField> = {}) =>
	({
		kind: "select",
		name,
		title: name,
		description: question,
		required: true,
		multiple: false,
		allowOther: true,
		options: [
			{ value: "Postgres", label: "Postgres", description: "Relational." },
			{ value: "Mongo", label: "Mongo", description: "Document." },
		],
		...over,
	}) as ElicitationField;

const ELICITATION_ID = "11111111-1111-4111-8111-111111111111";

const requestFor = (fields: ElicitationField[]): ElicitationRequestPayload => ({
	elicitationId: ELICITATION_ID,
	source: "assistant",
	server: "",
	mode: "form",
	message: "",
	fields,
});

const mount = (fields: ElicitationField[]) =>
	render(AskQuestion, { conversationId: "abc", request: requestFor(fields) });

const rows = (el: HTMLElement) => [
	...el.querySelectorAll<HTMLButtonElement>("button[aria-pressed]"),
];
const rowFor = (el: HTMLElement, text: string) =>
	rows(el).find((b) => (b.textContent ?? "").includes(text));
const button = (el: HTMLElement, label: string) =>
	[...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim().startsWith(label));

describe("a question from the assistant", () => {
	it("puts every option one click away, with no dropdown to open", () => {
		const { baseElement } = mount([ask("q1", "Which database?")]);
		expect(baseElement.querySelector("select")).toBeNull();
		// Two options plus "Something else…".
		expect(rows(baseElement)).toHaveLength(3);
		expect(baseElement.textContent).toContain("Relational.");
	});

	it("asks them one at a time rather than as a form", async () => {
		const { baseElement } = mount([ask("q1", "Which database?"), ask("q2", "Which host?")]);

		expect(baseElement.textContent).toContain("Which database?");
		expect(baseElement.textContent).not.toContain("Which host?");
		expect(baseElement.textContent).toContain("1 of 2");

		rowFor(baseElement, "Postgres")?.click();

		await vi.waitFor(() => expect(baseElement.textContent).toContain("Which host?"));
		expect(baseElement.textContent).not.toContain("Which database?");
	});

	it("sends each answer under its own question", async () => {
		const { baseElement } = mount([ask("q1", "Which database?"), ask("q2", "Which host?")]);
		rowFor(baseElement, "Postgres")?.click();
		await vi.waitFor(() => expect(baseElement.textContent).toContain("Which host?"));
		rowFor(baseElement, "Mongo")?.click();
		button(baseElement, "Send")?.click();

		await vi.waitFor(() => expect(sent).toHaveLength(1));
		expect(sent[0]).toMatchObject({ action: "accept", content: { q1: "Postgres", q2: "Mongo" } });
	});

	// Rendered one per test: two mounts share a document, so the helpers would find the
	// first panel's controls.
	it("keeps a single-pick question to one answer", async () => {
		const { baseElement } = mount([ask("q1", "Which database?")]);
		rowFor(baseElement, "Postgres")?.click();
		rowFor(baseElement, "Mongo")?.click();
		button(baseElement, "Send")?.click();
		await vi.waitFor(() => expect(sent).toHaveLength(1));
		expect(sent[0]).toMatchObject({ content: { q1: "Mongo" } });
	});

	it("keeps every pick when the question allows more than one", async () => {
		const { baseElement } = mount([ask("q1", "Which databases?", { multiple: true })]);
		rowFor(baseElement, "Postgres")?.click();
		rowFor(baseElement, "Mongo")?.click();
		button(baseElement, "Send")?.click();
		await vi.waitFor(() => expect(sent).toHaveLength(1));
		expect(sent[0]).toMatchObject({ content: { q1: ["Postgres", "Mongo"] } });
	});

	it("moves on by itself once a single-answer question is answered", async () => {
		const { baseElement } = mount([ask("q1", "Which database?"), ask("q2", "Which host?")]);
		expect(button(baseElement, "Next")).toBeUndefined();

		rowFor(baseElement, "Postgres")?.click();
		await vi.waitFor(() => expect(baseElement.textContent).toContain("Which host?"));
	});

	it("advances again when an earlier answer is changed", async () => {
		const { baseElement } = mount([ask("q1", "Which database?"), ask("q2", "Which host?")]);
		rowFor(baseElement, "Postgres")?.click();
		await vi.waitFor(() => expect(baseElement.textContent).toContain("Which host?"));

		button(baseElement, "Back")?.click();
		await vi.waitFor(() => expect(baseElement.textContent).toContain("Which database?"));
		rowFor(baseElement, "Mongo")?.click();

		await vi.waitFor(() => expect(baseElement.textContent).toContain("Which host?"));
	});

	it("never sends on its own, however the last question is answered", async () => {
		const { baseElement } = mount([ask("q1", "Which database?")]);
		rowFor(baseElement, "Postgres")?.click();

		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(sent).toHaveLength(0);
		expect(button(baseElement, "Send")).toBeDefined();
	});

	it("still asks for Next when one click cannot finish the question", async () => {
		const { baseElement } = mount([
			ask("q1", "Which databases?", { multiple: true }),
			ask("q2", "Which host?"),
		]);
		rowFor(baseElement, "Postgres")?.click();

		await vi.waitFor(() => expect(button(baseElement, "Next")).toBeDefined());
		expect(baseElement.textContent).toContain("Which databases?");

		button(baseElement, "Next")?.click();
		await vi.waitFor(() => expect(baseElement.textContent).toContain("Which host?"));
	});

	it("refuses to send the last question unanswered", async () => {
		const { baseElement } = mount([ask("q1", "Which database?")]);
		button(baseElement, "Send")?.click();

		await vi.waitFor(() => expect(baseElement.textContent).toContain("Pick an option"));
		expect(sent).toHaveLength(0);
	});

	it("takes an answer nobody offered", async () => {
		const { baseElement } = mount([ask("q1", "Which database?")]);
		rowFor(baseElement, "Something else")?.click();

		await vi.waitFor(() => expect(baseElement.querySelector('input[type="text"]')).not.toBeNull());
		const input = baseElement.querySelector<HTMLInputElement>('input[type="text"]');
		if (input) {
			input.value = "SQLite";
			input.dispatchEvent(new Event("input", { bubbles: true }));
		}
		button(baseElement, "Send")?.click();

		await vi.waitFor(() => expect(sent).toHaveLength(1));
		expect(sent[0]).toMatchObject({ content: { q1: "SQLite" } });
	});

	it("sends a typed answer when Enter is pressed on the last question", async () => {
		const { baseElement } = mount([ask("q1", "Which database?")]);
		rowFor(baseElement, "Something else")?.click();

		await vi.waitFor(() => expect(baseElement.querySelector('input[type="text"]')).not.toBeNull());
		const input = baseElement.querySelector<HTMLInputElement>('input[type="text"]');
		if (input) {
			input.value = "SQLite";
			input.dispatchEvent(new Event("input", { bubbles: true }));
			input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
		}

		await vi.waitFor(() => expect(sent).toHaveLength(1));
		expect(sent[0]).toMatchObject({ content: { q1: "SQLite" } });
	});

	it("advances to the next question when Enter is pressed before the last one", async () => {
		const { baseElement } = mount([ask("q1", "Which database?"), ask("q2", "Which host?")]);
		rowFor(baseElement, "Something else")?.click();

		await vi.waitFor(() => expect(baseElement.querySelector('input[type="text"]')).not.toBeNull());
		const input = baseElement.querySelector<HTMLInputElement>('input[type="text"]');
		if (input) {
			input.value = "SQLite";
			input.dispatchEvent(new Event("input", { bubbles: true }));
			input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
		}

		await vi.waitFor(() => expect(baseElement.textContent).toContain("Which host?"));
		expect(sent).toHaveLength(0);
	});

	it("suppresses the browser's own focus outline, as every other input here does", async () => {
		const { baseElement } = mount([ask("q1", "Which database?")]);
		rowFor(baseElement, "Something else")?.click();
		await vi.waitFor(() => expect(baseElement.querySelector('input[type="text"]')).not.toBeNull());

		const input = baseElement.querySelector<HTMLInputElement>('input[type="text"]');
		input?.focus();
		expect(getComputedStyle(input as Element).outlineStyle).toBe("none");
	});

	it("keeps the row under the options the same height throughout", async () => {
		const { baseElement } = mount([ask("q1", "Which database?"), ask("q2", "Which host?")]);
		const barHeight = () =>
			(baseElement.querySelector("div.mt-2.flex") as HTMLElement).getBoundingClientRect().height;

		// Send is taller than Skip, so without a floor the panel grows on the last question.
		const withSkipAlone = barHeight();
		rowFor(baseElement, "Postgres")?.click();
		await vi.waitFor(() => expect(baseElement.textContent).toContain("Which host?"));

		expect(barHeight()).toBe(withSkipAlone);
	});

	it("lets the user decline without answering", async () => {
		const { baseElement } = mount([ask("q1", "Which database?")]);
		button(baseElement, "Skip")?.click();

		await vi.waitFor(() => expect(sent).toHaveLength(1));
		expect(sent[0]).toMatchObject({ action: "decline" });
		expect(sent[0]).not.toHaveProperty("content");
	});
});

describe("the collapse handle", () => {
	const collapseButton = (el: HTMLElement) =>
		el.querySelector<HTMLButtonElement>('button[aria-label="Collapse question"]');
	const expandButton = (el: HTMLElement) =>
		el.querySelector<HTMLButtonElement>('button[aria-expanded="false"]');
	const body = (el: HTMLElement) =>
		el.querySelector<HTMLElement>('[role="group"] > [id]:not(button)');

	it("folds the panel to one line that says a question is waiting, and opens it again", async () => {
		const { baseElement } = mount([ask("q1", "Which database?", { title: "Database" })]);
		const panel = baseElement.querySelector<HTMLElement>('[role="group"]');
		const openHeight = panel?.getBoundingClientRect().height ?? 0;

		collapseButton(baseElement)?.click();
		await vi.waitFor(() => expect(expandButton(baseElement)).not.toBeNull());

		expect(expandButton(baseElement)?.textContent).toMatch(/Question waiting\s*Database/);
		expect(body(baseElement)?.hidden).toBe(true);
		expect(rows(baseElement).every((row) => row.offsetParent === null)).toBe(true);
		// One line: the row of buttons alone was taller than this.
		expect(panel?.getBoundingClientRect().height).toBeLessThan(56);
		expect(panel?.getBoundingClientRect().height).toBeLessThan(openHeight);

		expandButton(baseElement)?.click();
		await vi.waitFor(() => expect(body(baseElement)?.hidden).toBe(false));
		expect(expandButton(baseElement)).toBeNull();
		expect(baseElement.textContent).toContain("Which database?");
	});

	it("says which way it goes and to what, for assistive tech", async () => {
		const { baseElement } = mount([ask("q1", "Which database?")]);
		const id = body(baseElement)?.id;
		expect(id).toBeTruthy();
		expect(collapseButton(baseElement)?.getAttribute("aria-controls")).toBe(id);
		expect(collapseButton(baseElement)?.getAttribute("aria-expanded")).toBe("true");

		collapseButton(baseElement)?.click();
		await vi.waitFor(() => expect(expandButton(baseElement)).not.toBeNull());
		expect(expandButton(baseElement)?.getAttribute("aria-controls")).toBe(id);
	});

	it("works from the keyboard, keeping focus on the handle both ways", async () => {
		const { baseElement } = mount([ask("q1", "Which database?")]);

		collapseButton(baseElement)?.focus();
		await userEvent.keyboard("{Enter}");
		await vi.waitFor(() => expect(document.activeElement).toBe(expandButton(baseElement)));

		await userEvent.keyboard(" ");
		await vi.waitFor(() => expect(document.activeElement).toBe(collapseButton(baseElement)));
		expect(body(baseElement)?.hidden).toBe(false);
	});

	it("keeps what was picked and typed while folded away", async () => {
		const { baseElement } = mount([ask("q1", "Which database?", { multiple: true })]);
		rowFor(baseElement, "Postgres")?.click();
		rowFor(baseElement, "Something else")?.click();
		await vi.waitFor(() => expect(baseElement.querySelector('input[type="text"]')).not.toBeNull());
		const input = baseElement.querySelector<HTMLInputElement>('input[type="text"]');
		if (input) {
			input.value = "SQLite";
			input.dispatchEvent(new Event("input", { bubbles: true }));
		}

		collapseButton(baseElement)?.click();
		await vi.waitFor(() => expect(expandButton(baseElement)).not.toBeNull());
		expandButton(baseElement)?.click();
		await vi.waitFor(() => expect(body(baseElement)?.hidden).toBe(false));

		button(baseElement, "Send")?.click();
		await vi.waitFor(() => expect(sent).toHaveLength(1));
		expect(sent[0]).toMatchObject({ content: { q1: ["Postgres", "SQLite"] } });
	});

	it("opens a newer question expanded, even in the same panel", async () => {
		const screen = mount([ask("q1", "Which database?")]);
		collapseButton(screen.baseElement)?.click();
		await vi.waitFor(() => expect(expandButton(screen.baseElement)).not.toBeNull());

		await screen.rerender({
			request: {
				...requestFor([ask("q1", "Which host?")]),
				elicitationId: "22222222-2222-4222-8222-222222222222",
			},
		});

		await vi.waitFor(() => expect(body(screen.baseElement)?.hidden).toBe(false));
		expect(screen.baseElement.textContent).toContain("Which host?");
	});
});

describe("a question longer than the screen", () => {
	const long = (n: number) =>
		Array.from({ length: n }, (_, i) => `Sentence ${i + 1} of a long description.`).join(" ");
	const longQuestion = ask("q1", `${long(8)} Which one?`, {
		options: [1, 2, 3, 4].map((n) => ({
			value: `Option ${n}`,
			label: `Option ${n}`,
			description: long(6),
		})),
	});

	it("opens the typed-answer box in view and ready to type, however far down it lands", async () => {
		const { baseElement } = mount([longQuestion]);
		const options = baseElement.querySelector<HTMLElement>('[data-testid="ask-options"]');
		if (!options) throw new Error("no options list");
		options.scrollTop = 0;

		rowFor(baseElement, "Something else")?.click();

		const input = baseElement.querySelector<HTMLInputElement>('input[type="text"]');
		expect(document.activeElement).toBe(input);
		const box = input?.getBoundingClientRect();
		const within = options.getBoundingClientRect();
		expect(box?.top).toBeGreaterThanOrEqual(within.top);
		expect(box?.bottom).toBeLessThanOrEqual(within.bottom);
	});

	it("shows every word it was sent, with nothing marked as cut", () => {
		const { baseElement } = mount([longQuestion]);
		expect(baseElement.textContent).toContain(`${long(8)} Which one?`);
		expect(baseElement.textContent).toContain(long(6));
	});

	it("stays within its cap and scrolls its options, keeping the question and Send in view", async () => {
		const { baseElement } = mount([longQuestion]);
		const panel = baseElement.querySelector<HTMLElement>('[role="group"]');
		const options = baseElement.querySelector<HTMLElement>('[data-testid="ask-options"]');
		const visible = window.visualViewport?.height ?? window.innerHeight;
		if (!panel || !options) throw new Error("panel not rendered");

		expect(panel.getBoundingClientRect().height).toBeLessThanOrEqual(visible * 0.6 + 1);
		expect(options.scrollHeight).toBeGreaterThan(options.clientHeight);
		expect(getComputedStyle(options).overflowY).toBe("auto");
		expect(getComputedStyle(options).overscrollBehaviorY).toBe("contain");

		const send = button(baseElement, "Send");
		const question = baseElement.querySelector("p");
		for (const el of [send, question]) {
			const box = el?.getBoundingClientRect();
			const within = panel.getBoundingClientRect();
			expect(box?.top).toBeGreaterThanOrEqual(within.top);
			expect(box?.bottom).toBeLessThanOrEqual(within.bottom);
		}
	});
});

describe("a question that was answered before", () => {
	const refuse = (body: Record<string, unknown>) =>
		vi.stubGlobal("fetch", async () => new Response(JSON.stringify(body), { status: 409 }));

	/** As the transcript form does when it re-opens the question after a reload. */
	const mountRegistered = (fields: ElicitationField[]) => {
		const request = requestFor(fields);
		registerQuestion("abc", request);
		return render(AskQuestion, { conversationId: "abc", request });
	};

	afterEach(() => {
		unregisterQuestion(ELICITATION_ID);
		elicitationToResume.set(null);
	});

	it("stops asking and continues the call the earlier answer never did", async () => {
		// The row was resolved by an answer whose page lost its cue, so the transcript shows
		// the question open again; a second answer is refused, but it must not dead-end.
		refuse({
			message: "Already answered. Continuing with that answer.",
			answered: { action: "accept", resume: true, messageId: "m1" },
		});
		const { baseElement } = mountRegistered([ask("q1", "Which database?")]);
		rowFor(baseElement, "Postgres")?.click();
		button(baseElement, "Send")?.click();

		await vi.waitFor(() => expect(get(pendingQuestions)).toHaveLength(0));
		expect(get(elicitationToResume)).toEqual({
			conversationId: "abc",
			elicitationId: ELICITATION_ID,
			messageId: "m1",
		});
		expect(baseElement.textContent).not.toContain("Already answered");
	});

	it("stops asking, and nothing more, when the call was already continued", async () => {
		refuse({ message: "Already answered.", answered: { action: "accept", resume: false } });
		const { baseElement } = mountRegistered([ask("q1", "Which database?")]);
		button(baseElement, "Skip")?.click();

		await vi.waitFor(() => expect(get(pendingQuestions)).toHaveLength(0));
		expect(get(elicitationToResume)).toBeNull();
	});

	it("shows any other refusal and keeps the question open", async () => {
		refuse({ message: "This request has expired." });
		const { baseElement } = mountRegistered([ask("q1", "Which database?")]);
		rowFor(baseElement, "Postgres")?.click();
		button(baseElement, "Send")?.click();

		await vi.waitFor(() => expect(baseElement.textContent).toContain("This request has expired."));
		expect(get(pendingQuestions)).toHaveLength(1);
		expect(get(elicitationToResume)).toBeNull();
	});
});
