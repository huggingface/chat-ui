import ElicitationForm from "./ElicitationForm.svelte";
import { render } from "vitest-browser-svelte";
import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import type { ElicitationField, ElicitationRequestPayload } from "$lib/types/McpElicitation";

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
