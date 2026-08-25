import ChatMessage from "./ChatMessage.svelte";
import { render } from "vitest-browser-svelte";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

beforeEach(() => vi.stubGlobal("fetch", async () => new Response("{}", { status: 200 })));
afterEach(() => vi.unstubAllGlobals());

const call = (uuid: string) => ({
	type: "tool",
	subtype: "call",
	uuid,
	call: { name: "ask_user_question", parameters: {} },
});
const result = (uuid: string) => ({
	type: "tool",
	subtype: "result",
	uuid,
	result: {
		status: 0,
		call: { name: "ask_user_question", parameters: {} },
		outputs: [{ text: "The user answered: S3" }],
		display: true,
	},
});
const answeredQuestion = [
	{
		type: "elicitation",
		subtype: "request",
		toolUuid: "u1",
		request: {
			elicitationId: "e1",
			source: "assistant",
			server: "",
			mode: "form",
			message: "",
			fields: [
				{
					kind: "select",
					name: "q1",
					title: "Storage",
					description: "Where should uploads go?",
					required: true,
					multiple: false,
					options: [{ value: "S3", label: "S3" }],
				},
			],
		},
	},
	{
		type: "elicitation",
		subtype: "resolved",
		elicitationId: "e1",
		action: "accept",
		resolution: "user",
		content: { q1: "S3" },
	},
];

const mount = (updates: unknown[], content = "") =>
	render(ChatMessage, {
		message: { id: "m1", from: "assistant", content, children: [], updates },
		loading: true,
		isLast: true,
		isAuthor: true,
		readOnly: false,
	} as never);

const spinners = (el: HTMLElement) => el.querySelectorAll(".loading").length;

describe("a run still working with nothing streaming", () => {
	// One mount per test: they share a document, so a second would count the first's.
	it("says so after a question has been answered", () => {
		// The settled row is all there is while the call restarts, and it does not animate.
		expect(spinners(mount([call("u1"), ...answeredQuestion]).baseElement)).toBe(1);
	});

	it("says so while the model thinks after a tool has finished", () => {
		expect(spinners(mount([call("u1"), result("u1"), ...answeredQuestion]).baseElement)).toBe(1);
	});

	it("adds nothing while reasoning streams, which shows its own progress", () => {
		// An unclosed <think> is reasoning still arriving; it animates itself without this
		// class, so anything here would be ours doubling up.
		const { baseElement } = mount([], "<think>weighing the options");
		expect(spinners(baseElement)).toBe(0);
	});
});
