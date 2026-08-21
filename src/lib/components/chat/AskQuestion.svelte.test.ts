import AskQuestion from "./AskQuestion.svelte";
import { render } from "vitest-browser-svelte";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import type { ElicitationField, ElicitationRequestPayload } from "$lib/types/McpElicitation";

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

const mount = (fields: ElicitationField[]) => {
	const request: ElicitationRequestPayload = {
		elicitationId: "11111111-1111-4111-8111-111111111111",
		source: "assistant",
		server: "",
		mode: "form",
		message: "",
		fields,
	};
	return render(AskQuestion, { conversationId: "abc", request });
};

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
