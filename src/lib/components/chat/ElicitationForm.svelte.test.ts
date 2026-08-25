import ElicitationForm from "./ElicitationForm.svelte";
import { render } from "vitest-browser-svelte";
import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import type { ElicitationField, ElicitationRequestPayload } from "$lib/types/McpElicitation";
import { MessageElicitationUpdateType, MessageUpdateType } from "$lib/types/MessageUpdate";
import { pendingQuestions, unregisterQuestion } from "$lib/stores/pendingQuestion";
import { get } from "svelte/store";

/** Answers are POSTed, so what reaches the server is the assertion worth making. */
let sent: Array<Record<string, unknown>>;

beforeEach(() => {
	sent = [];
	vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
		sent.push(JSON.parse(String(init?.body)));
		return new Response(JSON.stringify({ ok: true, resume: false }), { status: 200 });
	});
});

afterEach(() => vi.unstubAllGlobals());

const formWith = (fields: ElicitationField[]): ElicitationRequestPayload => ({
	elicitationId: "11111111-1111-4111-8111-111111111111",
	server: "Mock",
	mode: "form",
	message: "Answer please.",
	fields,
});

const mount = (fields: ElicitationField[]) =>
	render(ElicitationForm, { conversationId: "abc", request: formWith(fields) });

const submit = async (baseElement: HTMLElement) => {
	const send = [...baseElement.querySelectorAll("button")].find((b) =>
		/send|submit/i.test(b.textContent ?? "")
	);
	send?.click();
	await vi.waitFor(() => expect(sent).toHaveLength(1));
	return sent[0].content as Record<string, unknown> | undefined;
};

describe("an optional checkbox nobody touched", () => {
	const notify: ElicitationField = {
		kind: "boolean",
		name: "notify",
		title: "Notify",
		required: false,
	};

	it("is left out rather than answered false", async () => {
		const content = await submit(mount([notify]).baseElement);
		expect(content).not.toHaveProperty("notify");
	});

	it("is sent once the user actually unticks it", async () => {
		const { baseElement } = mount([{ ...notify, default: true }]);
		const box = baseElement.querySelector<HTMLInputElement>('input[type="checkbox"]');
		box?.click();
		expect(await submit(baseElement)).toMatchObject({ notify: false });
	});

	it("still sends the server's default when left alone", async () => {
		const content = await submit(mount([{ ...notify, default: true }]).baseElement);
		expect(content).toMatchObject({ notify: true });
	});
});

describe("a multi-select at its maxItems", () => {
	const toppings: ElicitationField = {
		kind: "select",
		name: "toppings",
		title: "Toppings",
		required: true,
		multiple: true,
		maxItems: 2,
		options: ["a", "b", "c"].map((v) => ({ value: v, label: v.toUpperCase() })),
	};

	it("disables the unpicked options instead of waiting for submit", async () => {
		const { baseElement } = mount([toppings]);
		const boxes = () => [
			...baseElement.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
		];

		expect(boxes().every((b) => !b.disabled)).toBe(true);

		boxes()[0].click();
		boxes()[1].click();

		await vi.waitFor(() => expect(boxes()[2].disabled).toBe(true));
		// The two already picked stay live, or the choice could not be undone.
		expect(boxes()[0].disabled).toBe(false);
		expect(boxes()[1].disabled).toBe(false);
	});
});

describe("a date default the server sent as RFC 3339", () => {
	it("fills the control rather than rendering blank", async () => {
		const { baseElement } = mount([
			{
				kind: "string",
				name: "starts_at",
				title: "Starts at",
				required: false,
				format: "date-time",
				default: "2026-09-01T09:30:00Z",
			},
		]);
		const input = baseElement.querySelector<HTMLInputElement>('input[type="datetime-local"]');
		expect(input?.value).toMatch(/^2026-09-0[12]T\d{2}:\d{2}$/);
	});

	it("submits it back as RFC 3339, not the timezone-less local value", async () => {
		const { baseElement } = mount([
			{
				kind: "string",
				name: "starts_at",
				required: false,
				format: "date-time",
				default: "2026-09-01T09:30:00Z",
			},
		]);
		expect(await submit(baseElement)).toMatchObject({ starts_at: "2026-09-01T09:30:00.000Z" });
	});

	it("leaves a date-only default on its own day", async () => {
		// It parses as UTC midnight, so a local round-trip would show the day before
		// to everyone west of UTC.
		const { baseElement } = mount([
			{ kind: "string", name: "day", required: false, format: "date", default: "2026-09-01" },
		]);
		const input = baseElement.querySelector<HTMLInputElement>('input[type="date"]');
		expect(input?.value).toBe("2026-09-01");
	});
});

describe('an "Other" answer', () => {
	const pick = (over: Partial<ElicitationField> = {}): ElicitationField =>
		({
			kind: "select",
			name: "pick",
			title: "Pick",
			required: true,
			multiple: false,
			allowOther: true,
			options: [
				{ value: "A", label: "A" },
				{ value: "B", label: "B" },
			],
			...over,
		}) as ElicitationField;

	const otherInput = (el: HTMLElement) => el.querySelector<HTMLInputElement>('input[type="text"]');

	/** Chosen by its label, so the test never has to know the marker value. */
	const chooseOther = async (el: HTMLElement) => {
		const select = el.querySelector<HTMLSelectElement>("select");
		const option = [...(select?.options ?? [])].find((o) =>
			/Something else/.test(o.textContent ?? "")
		);
		expect(option).toBeDefined();
		if (select && option) {
			select.value = option.value;
			select.dispatchEvent(new Event("change", { bubbles: true }));
		}
		await vi.waitFor(() => expect(otherInput(el)).not.toBeNull());
	};

	const type = (el: HTMLElement, text: string) => {
		const input = otherInput(el);
		if (input) {
			input.value = text;
			input.dispatchEvent(new Event("input", { bubbles: true }));
		}
	};

	it("stays hidden until the user reaches for it", async () => {
		const { baseElement } = mount([pick()]);
		expect(otherInput(baseElement)).toBeNull();
		await chooseOther(baseElement);
		expect(otherInput(baseElement)).not.toBeNull();
	});

	it("sends what was typed, not the marker", async () => {
		const { baseElement } = mount([pick()]);
		await chooseOther(baseElement);
		type(baseElement, "Neither, use SQLite");
		expect(await submit(baseElement)).toMatchObject({ pick: "Neither, use SQLite" });
	});

	it("refuses to submit while the box is empty, rather than dropping the answer", async () => {
		const { baseElement } = mount([pick()]);
		await chooseOther(baseElement);

		const send = [...baseElement.querySelectorAll("button")].find((b) =>
			/send|submit/i.test(b.textContent ?? "")
		);
		send?.click();

		await vi.waitFor(() => expect(baseElement.textContent).toMatch(/Other/));
		expect(sent).toHaveLength(0);
	});
});

describe("a question the model asked", () => {
	const question: ElicitationField = {
		kind: "select",
		name: "q1",
		title: "Storage",
		description: "Where should uploads go?",
		required: true,
		multiple: false,
		options: [
			{ value: "S3", label: "S3" },
			{ value: "Disk", label: "Disk" },
		],
	};

	const askRequest = (): ElicitationRequestPayload => ({
		...formWith([question]),
		source: "assistant",
	});

	afterEach(() => {
		for (const q of get(pendingQuestions)) unregisterQuestion(q.request.elicitationId);
	});

	it("is handed to the composer rather than drawn in the transcript", async () => {
		const { baseElement } = render(ElicitationForm, {
			conversationId: "abc",
			request: askRequest(),
		});

		expect(baseElement.querySelector("select")).toBeNull();
		expect(baseElement.textContent).not.toContain("Where should uploads go?");
		await vi.waitFor(() =>
			expect(get(pendingQuestions)).toMatchObject([{ conversationId: "abc" }])
		);
	});

	it("stays in the transcript once answered, and lets the composer go", async () => {
		const { baseElement } = render(ElicitationForm, {
			conversationId: "abc",
			request: askRequest(),
			resolved: {
				type: MessageUpdateType.Elicitation,
				subtype: MessageElicitationUpdateType.Resolved,
				elicitationId: askRequest().elicitationId,
				action: "accept",
				resolution: "user",
				content: { q1: "S3" },
			},
		});

		expect(baseElement.textContent).toContain("Answered");
		expect(get(pendingQuestions)).toHaveLength(0);
	});

	it("does not let a later question hide one still waiting", async () => {
		const first = askRequest();
		const second = { ...askRequest(), elicitationId: "22222222-2222-4222-8222-222222222222" };
		render(ElicitationForm, { conversationId: "abc", request: first });
		render(ElicitationForm, { conversationId: "abc", request: second });

		await vi.waitFor(() => expect(get(pendingQuestions)).toHaveLength(2));
		expect(get(pendingQuestions)[0].request.elicitationId).toBe(first.elicitationId);

		unregisterQuestion(second.elicitationId);
		expect(get(pendingQuestions)).toHaveLength(1);
		expect(get(pendingQuestions)[0].request.elicitationId).toBe(first.elicitationId);
	});

	it("leaves an MCP prompt in the transcript where it belongs", () => {
		const { baseElement } = render(ElicitationForm, {
			conversationId: "abc",
			request: formWith([question]),
		});

		expect(baseElement.querySelector("select")).not.toBeNull();
		expect(get(pendingQuestions)).toHaveLength(0);
	});
});
