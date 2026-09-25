import { afterEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Message } from "$lib/types/Message";
import type { makeImageProcessor } from "$lib/server/endpoints/images";
import { messageForStorage } from "$lib/server/generation/compressUpdates";
import { prepareMessagesWithFiles } from "$lib/server/textGeneration/utils/prepareFiles";
import {
	assistantMessage,
	finalAnswer,
	toolRound,
} from "$lib/server/generation/__tests__/turnFixtures";

const env = vi.hoisted(() => ({}) as Record<string, string | boolean>);
const edits = vi.hoisted(() => ({ preset: "", doctrine: "" }));

vi.mock("$lib/server/config", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/server/config")>();
	return {
		...actual,
		config: new Proxy(actual.config, {
			get: (target, prop) =>
				typeof prop === "string" && prop in env ? env[prop] : Reflect.get(target, prop),
		}),
	};
});
vi.mock("$lib/utils/mlAssistantFlag", () => ({ ML_ASSISTANT_MODE: true }));
vi.mock("$lib/server/mlAssistantModels", async (importOriginal) => ({
	...(await importOriginal<typeof import("$lib/server/mlAssistantModels")>()),
	mlAssistantModelEntry: (id: string) =>
		id === "pinned/model" ? { id, provider: "together" } : undefined,
}));
vi.mock("$lib/server/mlAssistantPrompt", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/server/mlAssistantPrompt")>();
	return {
		...actual,
		mlAssistantPreprompt: (options: Parameters<typeof actual.mlAssistantPreprompt>[0]) =>
			actual.mlAssistantPreprompt(options) + edits.preset,
		mlAssistantToolDoctrineBlocks: (
			...args: Parameters<typeof actual.mlAssistantToolDoctrineBlocks>
		) => actual.mlAssistantToolDoctrineBlocks(...args).map((block) => block + edits.doctrine),
	};
});

const { mlAssistantPromptHash, stampMlHarness } = await import("./mlAssistantHarness");

afterEach(() => {
	for (const key of Object.keys(env)) delete env[key];
	edits.preset = "";
	edits.doctrine = "";
	vi.useRealTimers();
});

const mlConv = () => ({ _id: new ObjectId(), mlAssistant: true });
const MODEL = { id: "test-org/test-model" };

const blank = (): Message => ({ id: crypto.randomUUID(), from: "assistant", content: "" });

describe("stampMlHarness", () => {
	it("stamps nothing outside the mode", () => {
		const message = blank();
		expect(stampMlHarness(message, { _id: new ObjectId() }, MODEL)).toBeUndefined();
		expect(message.harness).toBeUndefined();
	});

	it("records the build, the prompt, the switches and the model", () => {
		env.PUBLIC_COMMIT_SHA = "1d614ad";
		const message = blank();
		const conv = mlConv();

		const harness = stampMlHarness(message, conv, MODEL);

		expect(message.harness).toEqual(harness);
		expect(harness).toEqual({
			build: "1d614ad",
			prompt: mlAssistantPromptHash(conv),
			features: {
				virtualFiles: true,
				stateBlock: true,
				servicePoller: true,
				serviceEvents: true,
				slidingWindow: true,
			},
			model: MODEL.id,
			runs: 1,
		});
		expect(harness?.prompt).toMatch(/^[0-9a-f]{12}$/);
	});

	it("names a build without a commit sha dev", () => {
		env.PUBLIC_COMMIT_SHA = "";
		expect(stampMlHarness(blank(), mlConv(), MODEL)?.build).toBe("dev");
	});

	it("records the provider the model set pins, only where it is sent", () => {
		const pinned = { id: "pinned/model" };
		env.isHuggingChat = true;
		expect(stampMlHarness(blank(), mlConv(), pinned)?.provider).toBe("together");
		expect(stampMlHarness(blank(), mlConv(), MODEL)).not.toHaveProperty("provider");
		expect(stampMlHarness(blank(), mlConv(), { ...pinned, isRouter: true })).not.toHaveProperty(
			"provider"
		);

		env.isHuggingChat = false;
		expect(stampMlHarness(blank(), mlConv(), pinned)).not.toHaveProperty("provider");
	});

	it("replaces the previous run's stamp and counts the runs", () => {
		const message = blank();
		const conv = mlConv();
		stampMlHarness(message, conv, MODEL);

		env.ML_ASSISTANT_STATE_BLOCK = "false";
		stampMlHarness(message, conv, { id: "other/model" });

		expect(message.harness).toMatchObject({
			model: "other/model",
			features: { stateBlock: false },
			runs: 2,
		});
	});

	it.each([
		["ML_ASSISTANT_VIRTUAL_FILES", { virtualFiles: false }],
		["ML_ASSISTANT_STATE_BLOCK", { stateBlock: false }],
		["ML_ASSISTANT_SERVICE_POLLER", { servicePoller: false, serviceEvents: false }],
		["ML_ASSISTANT_SERVICE_EVENTS", { serviceEvents: false }],
		["HISTORY_SLIDING_WINDOW", { slidingWindow: false }],
	])("reads %s off like the code does", (key, off) => {
		env[key] = "false";
		expect(stampMlHarness(blank(), mlConv(), MODEL)?.features).toEqual({
			virtualFiles: true,
			stateBlock: true,
			servicePoller: true,
			serviceEvents: true,
			slidingWindow: true,
			...off,
		});
	});
});

describe("mlAssistantPromptHash", () => {
	it("does not move with the clock, the conversation or its plan", () => {
		vi.useFakeTimers({ now: new Date("2026-09-25T09:00:00Z") });
		const first = mlAssistantPromptHash(mlConv());
		vi.setSystemTime(new Date("2026-12-31T23:59:00Z"));
		const later = mlAssistantPromptHash({
			...mlConv(),
			plan: {
				goal: "g",
				steps: [{ step: "s", status: "in_progress" }],
				version: 3,
				updatedAt: new Date(),
			},
		});
		expect(later).toBe(first);
	});

	it("moves when the preset text changes, and back when the edit is undone", () => {
		const conv = mlConv();
		const before = mlAssistantPromptHash(conv);
		edits.preset = " Always pin trl.";
		expect(mlAssistantPromptHash(conv)).not.toBe(before);
		edits.preset = "";
		expect(mlAssistantPromptHash(conv)).toBe(before);
	});

	it("moves when a tool contract changes", () => {
		const conv = mlConv();
		const before = mlAssistantPromptHash(conv);
		edits.doctrine = " Name every job.";
		expect(mlAssistantPromptHash(conv)).not.toBe(before);
	});

	it.each([
		"ML_ASSISTANT_VIRTUAL_FILES",
		"ML_ASSISTANT_STATE_BLOCK",
		"ML_ASSISTANT_SERVICE_EVENTS",
	])("moves with %s, which changes the text sent", (key) => {
		const conv = mlConv();
		const before = mlAssistantPromptHash(conv);
		env[key] = "false";
		expect(mlAssistantPromptHash(conv)).not.toBe(before);
	});

	it("stays put for the sliding window, which sends no text of its own", () => {
		const conv = mlConv();
		const before = mlAssistantPromptHash(conv);
		env.HISTORY_SLIDING_WINDOW = "false";
		expect(mlAssistantPromptHash(conv)).toBe(before);
	});
});

describe("a stamped message", () => {
	const stamped = () => {
		const message = assistantMessage([
			...toolRound({ text: "Let me check.", tools: ["get_weather"] }),
			...finalAnswer(undefined, "It is 18°C."),
		]);
		stampMlHarness(message, mlConv(), MODEL);
		return message;
	};

	it("keeps the stamp through the end-of-turn save", () => {
		const message = stamped();
		const stored = messageForStorage(message);
		expect(stored.contentShape).toBe(2);
		expect(stored.harness).toEqual(message.harness);
	});

	it("never sends it to the model", async () => {
		env.PUBLIC_COMMIT_SHA = "sha-never-sent";
		const message = stamped();
		const prepared = await prepareMessagesWithFiles(
			[{ from: "user", content: "weather?" }, message],
			(() => {
				throw new Error("no images here");
			}) as unknown as ReturnType<typeof makeImageProcessor>,
			false
		);
		expect(prepared.length).toBeGreaterThan(1);
		const sent = JSON.stringify(prepared);
		expect(sent).not.toContain("sha-never-sent");
		expect(sent).not.toContain("harness");
	});
});
