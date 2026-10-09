import { describe, expect, it } from "vitest";
import { MessageUpdateType, type MessageUpdate } from "$lib/types/MessageUpdate";
import type { EndpointMessage } from "../endpoints/endpoints";
import {
	activityLabelMessages,
	buildActivityLabelPrompt,
	cleanActivityLabel,
	createActivityLabeler,
	formatToolCall,
	isGroundedLabel,
	stripCode,
	type ActivityLabelGenerate,
	type ActivityLabeler,
} from "./activityLabels";

describe("label prompt", () => {
	it("gives the reply language, the reasoning tail and the running calls, not the user request", () => {
		const prompt = buildActivityLabelPrompt({
			language: "French",
			reasoning: "x".repeat(2000) + " Now compute the growth.",
			calls: ['run_python(code="import pandas")'],
		});
		expect(prompt.startsWith("Reply language: French\n\nLatest reasoning:\n<<<\n")).toBe(true);
		expect(prompt).toContain("Now compute the growth.\n>>>");
		expect(prompt).toContain('Tool calls running now: run_python(code="import pandas")');
		expect(prompt.endsWith("Status:")).toBe(true);
		const reasoning = prompt.split("<<<\n")[1].split("\n>>>")[0];
		expect(reasoning.length).toBe(800);
	});

	it("says when nothing is running and leaves out empty parts", () => {
		const prompt = buildActivityLabelPrompt({ language: "English", reasoning: "", calls: [] });
		expect(prompt).toBe("Reply language: English\n\nTool calls running now: none\n\nStatus:");
	});

	it("puts four example turns before the request", () => {
		const messages = activityLabelMessages({ language: "English", reasoning: "Plan", calls: [] });
		expect(messages).toHaveLength(9);
		expect(messages.at(-1)?.content).toContain("Plan");
	});

	it("replaces code with a marker so the sentences around it stay in the tail", () => {
		const text = [
			"Let me write the app:",
			"```python",
			"import gradio as gr",
			"```",
			"Then the requirements:",
			"    gradio",
			"    pypdf",
			"def helper():",
			"Done.",
		].join("\n");
		expect(stripCode(text)).toBe(
			"Let me write the app:\n [code] Then the requirements:\n[code] Done."
		);
	});

	it("formats a call by name and arguments, without file contents or secrets", () => {
		expect(
			formatToolCall(
				"upload_file",
				JSON.stringify({
					repo_id: "victor/pdf-chat",
					path_in_repo: "app.py",
					content: "x".repeat(500),
				})
			)
		).toBe('upload_file(repo_id="victor/pdf-chat", path_in_repo="app.py")');
		expect(formatToolCall("web_search_exa", "{not json")).toBe("web_search_exa()");
		expect(
			formatToolCall(
				"hf_sandbox_exec",
				JSON.stringify({ command: "login --token hf_abcdefghijklmnop" })
			)
		).not.toContain("hf_abcdefghijklmnop");
	});

	it.each([
		['"Searching the arXiv page."', "Searching the arXiv page"],
		["Status: Reading app.py\nextra line", "Reading app.py"],
		["<think>hmm</think>Recherche des prix Eurostat 2025", "Recherche des prix Eurostat 2025"],
		["Logging in with hf_abcdefghijklmnop", "Logging in with <redacted>"],
		["", undefined],
		[Array(20).fill("word").join(" "), undefined],
	])("cleans %j to %j", (raw, cleaned) => {
		expect(cleanActivityLabel(raw)).toBe(cleaned);
	});

	it("rejects a label naming something its input never mentions", () => {
		const source = "Need the Svelte 5.2 changelog from svelte.dev before comparing.";
		expect(isGroundedLabel("Reading the Svelte 5.2 changelog", source)).toBe(true);
		expect(isGroundedLabel("Reading svelte.dev release notes", source)).toBe(true);
		expect(isGroundedLabel("Checking React StrictMode docs", source)).toBe(false);
		expect(isGroundedLabel("Searching the Hub for TTS Spaces", "hf_fs(search tts)")).toBe(true);
		expect(isGroundedLabel("Searching the Hub for Whisper models", "hf_fs(search tts)")).toBe(
			false
		);
	});
});

/** a task model that answers instantly, saying which kind of request it got */
function fakeModel(reply?: (request: string, n: number) => string) {
	const calls: EndpointMessage[][] = [];
	const generate: ActivityLabelGenerate = async (messages) => {
		calls.push(messages);
		const request = messages.at(-1)?.content ?? "";
		if (reply) return reply(request, calls.length);
		// number words: a digit missing from the input would fail the grounding check
		const nth = ["zero", "one", "two", "three", "four", "five"][calls.length] ?? "many";
		return request.includes("Tool calls running now: none")
			? `Thinking label ${nth}.`
			: `"Tools label ${nth}"`;
	};
	return { calls, generate };
}

const settle = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

async function collect(labeler: ActivityLabeler, wait = 0): Promise<MessageUpdate[]> {
	await settle(wait);
	labeler.close();
	const out: MessageUpdate[] = [];
	for await (const update of labeler.updates()) out.push(update);
	return out;
}
const labelsOf = (updates: MessageUpdate[]) =>
	updates.flatMap((u) =>
		u.type === MessageUpdateType.ActivityLabel ? [[u.round, u.phase, u.text]] : []
	);

describe("createActivityLabeler", () => {
	it("labels long reasoning at most once per interval", async () => {
		let clock = 0;
		const model = fakeModel();
		const labeler = createActivityLabeler({
			userText: "Which models lead LMArena?",
			generate: model.generate,
			now: () => clock,
			minNewChars: 100,
			minIntervalMs: 3000,
		});
		labeler.reasoning("a".repeat(50));
		await settle();
		expect(model.calls).toHaveLength(0);
		labeler.reasoning("a".repeat(60));
		await settle();
		expect(model.calls).toHaveLength(1);
		labeler.reasoning("a".repeat(200));
		await settle();
		expect(model.calls).toHaveLength(1);
		clock = 3500;
		labeler.reasoning("a");
		await settle();
		expect(model.calls).toHaveLength(2);
		expect(labelsOf(await collect(labeler))).toEqual([
			[0, "thinking", "Thinking label one"],
			[0, "thinking", "Thinking label two"],
		]);
	});

	it("keeps a summary for the row, describes the calls once they run, and moves rounds", async () => {
		let clock = 0;
		const model = fakeModel();
		const labeler = createActivityLabeler({
			userText: "hi",
			generate: model.generate,
			now: () => clock,
			toolsDelayMs: 5,
		});
		labeler.iterationStart();
		labeler.reasoning("I should search both leaderboards first, then verify the dates.");
		clock = 4000;
		labeler.toolCalls([{ name: "web_search_exa", arguments: '{"query":"LMArena"}' }]);
		await settle(20);
		labeler.roundDone();
		labeler.reasoning("Both agree on the top cluster. Now the model cards are next.");
		labeler.content("Now the model cards.");
		const updates = await collect(labeler, 5);
		expect(labelsOf(updates).map(([round, phase]) => [round, phase])).toEqual([
			[0, "summary"],
			[0, "tools"],
			[1, "summary"],
		]);
		expect(updates).toContainEqual({
			type: MessageUpdateType.ActivityTiming,
			round: 0,
			thinkingMs: 4000,
		});
		expect(
			model.calls.some((c) => c.at(-1)?.content.includes('web_search_exa(query="LMArena")'))
		).toBe(true);
	});

	it("skips the calls label when the calls finish before it could be written", async () => {
		const model = fakeModel();
		const labeler = createActivityLabeler({
			userText: "hi",
			generate: model.generate,
			toolsDelayMs: 50,
		});
		labeler.toolCalls([{ name: "web_search_exa", arguments: "{}" }]);
		labeler.roundDone();
		await settle(80);
		expect(labelsOf(await collect(labeler))).toEqual([]);
	});

	it("drops a progress label that comes back after the reasoning ended", async () => {
		let release: (value: string) => void = () => {};
		const generate: ActivityLabelGenerate = () => new Promise((resolve) => (release = resolve));
		const labeler = createActivityLabeler({ userText: "hi", generate, minNewChars: 10 });
		labeler.reasoning("Reasoning about the plan in some detail now.");
		labeler.content("Here is the answer.");
		release("Planning the answer");
		const phases = labelsOf(await collect(labeler, 5)).map(([, phase]) => phase);
		expect(phases).not.toContain("thinking");
	});

	it("drops a label that names something not in its input", async () => {
		const model = fakeModel(() => "Reading React StrictMode docs");
		const labeler = createActivityLabeler({ userText: "hi", generate: model.generate });
		labeler.reasoning("Need the Svelte changelog before comparing anything at all.");
		labeler.content("Checking.");
		expect(labelsOf(await collect(labeler, 5))).toEqual([]);
	});

	it("follows reasoning streamed inline as <think> blocks", async () => {
		let clock = 0;
		const model = fakeModel();
		const labeler = createActivityLabeler({
			userText: "hi",
			generate: model.generate,
			now: () => clock,
		});
		labeler.stream("<think>The greeting needs a short friendly reply, nothing more");
		clock = 1500;
		labeler.stream(" to add.</think>Hello! How can I help?");
		const updates = await collect(labeler, 5);
		expect(updates).toContainEqual({
			type: MessageUpdateType.ActivityTiming,
			round: 0,
			thinkingMs: 1500,
		});
		expect(labelsOf(updates).map(([, phase]) => phase)).toEqual(["summary"]);
		expect(model.calls[0].at(-1)?.content).toContain("The greeting needs a short friendly reply");
	});

	it("stamps reasoning times without asking the task model when labels are off", async () => {
		let clock = 0;
		const model = fakeModel();
		const labeler = createActivityLabeler({
			userText: "hi",
			generate: model.generate,
			labels: false,
			now: () => clock,
		});
		labeler.reasoning("A long enough stretch of reasoning to summarize if we could.");
		clock = 2000;
		labeler.toolCalls([{ name: "web_search_exa", arguments: "{}" }]);
		const updates = await collect(labeler, 20);
		expect(updates).toEqual([
			{ type: MessageUpdateType.ActivityTiming, round: 0, thinkingMs: 2000 },
		]);
		expect(model.calls).toHaveLength(0);
	});

	it("gives a summary still being written a moment to land when the turn finishes", async () => {
		const generate: ActivityLabelGenerate = () =>
			new Promise((resolve) => setTimeout(() => resolve("Picking a friendly greeting"), 30));
		const labeler = createActivityLabeler({ userText: "hi", generate, drainMs: 500 });
		labeler.reasoning("Picking a friendly greeting reply for the user who said hello.");
		labeler.content("Hello!");
		const out: MessageUpdate[] = [];
		const reading = (async () => {
			for await (const update of labeler.updates()) out.push(update);
		})();
		await labeler.finish();
		await reading;
		expect(labelsOf(out)).toEqual([[0, "summary", "Picking a friendly greeting"]]);
	});

	it("continues the round count of a message that already holds rounds", async () => {
		const model = fakeModel();
		const labeler = createActivityLabeler({
			userText: "hi",
			generate: model.generate,
			startRound: 3,
			toolsDelayMs: 0,
		});
		labeler.toolCalls([{ name: "web_search_exa", arguments: "{}" }]);
		expect(labelsOf(await collect(labeler, 10)).map(([round]) => round)).toEqual([3]);
	});

	it("asks in the user's language", async () => {
		const model = fakeModel();
		const labeler = createActivityLabeler({
			userText: "Voici mes ventes mensuelles, calcule la croissance et fais un graphique.",
			generate: model.generate,
			toolsDelayMs: 0,
		});
		labeler.toolCalls([{ name: "run_python", arguments: "{}" }]);
		await collect(labeler, 10);
		expect(model.calls[0].at(-1)?.content).toContain("Reply language: French");
	});

	it("drops a label the task model is too slow to write", async () => {
		const generate: ActivityLabelGenerate = (_messages, signal) =>
			new Promise((_resolve, reject) =>
				signal.addEventListener("abort", () => reject(new Error("aborted")))
			);
		const labeler = createActivityLabeler({
			userText: "hi",
			generate,
			timeoutMs: 5,
			toolsDelayMs: 0,
		});
		labeler.toolCalls([{ name: "web_search_exa", arguments: "{}" }]);
		expect(labelsOf(await collect(labeler, 30))).toEqual([]);
	});

	it("stops once closed", async () => {
		const model = fakeModel();
		const labeler = createActivityLabeler({ userText: "hi", generate: model.generate });
		labeler.close();
		labeler.reasoning("a".repeat(1000));
		labeler.toolCalls([{ name: "web_search_exa", arguments: "{}" }]);
		expect(await collect(labeler, 10)).toEqual([]);
		expect(model.calls).toHaveLength(0);
	});
});
