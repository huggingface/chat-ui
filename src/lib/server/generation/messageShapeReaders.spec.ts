import { describe, expect, it } from "vitest";
import { convertMessageShape } from "./messageShape";
import { convertingTurns, preamblesTrimmed } from "./__tests__/turnFixtures";
import { prepareMessagesWithFiles } from "$lib/server/textGeneration/utils/prepareFiles";
import { stripReasoningFromMessageForRouting } from "$lib/server/textGeneration/utils/routing";
import { collectArtifacts } from "$lib/utils/artifacts";
import { toLegacyShape } from "$lib/utils/messageShape";
import { buildPrompt } from "$lib/buildPrompt";
import type { BackendModel } from "$lib/server/models";
import type { makeImageProcessor } from "$lib/server/endpoints/images";
import type { Message } from "$lib/types/Message";

const imageProcessor = (() => {
	throw new Error("no images here");
}) as unknown as ReturnType<typeof makeImageProcessor>;

const user = (content: string): Message => ({
	id: crypto.randomUUID(),
	from: "user",
	content,
});

const cases = Object.entries(convertingTurns()).map(([name, legacy]) => {
	const result = convertMessageShape(legacy);
	if (!("message" in result)) throw new Error(`${name} did not convert: ${result.skipped}`);
	return { name, legacy, rounds: result.message };
});

describe.each(cases)("$name", ({ legacy, rounds }) => {
	const history = (message: Message) => [user("Weather?"), message, user("And now?")];

	it("is actually stored differently, and gives back exactly what it was", () => {
		expect(rounds.content).not.toBe(legacy.content);
		expect(rounds.updates).not.toEqual(legacy.updates);
		expect(preamblesTrimmed(toLegacyShape(rounds))).toEqual(legacy);
	});

	it.each([
		["tool replay with reasoning", { replayToolHistory: true }],
		["tool replay without reasoning", { replayToolHistory: true, attachReasoning: false }],
		["flat history that ran out of budget", { replayToolHistory: true, contextLengthTokens: 1 }],
		["flat history with reasoning", { attachReasoning: true }],
		["flat history", {}],
	] as const)("replays the same %s", async (_label, options) => {
		const fromLegacy = await prepareMessagesWithFiles(
			history(legacy),
			imageProcessor,
			false,
			options
		);
		const fromRounds = await prepareMessagesWithFiles(
			history(rounds),
			imageProcessor,
			false,
			options
		);
		expect(fromRounds).toEqual(fromLegacy);
	});

	it("collects the same artifacts", () => {
		expect(collectArtifacts([rounds])).toEqual(collectArtifacts([legacy]));
	});

	it("strips the same text for the router", () => {
		const stripped = stripReasoningFromMessageForRouting(rounds);
		expect(stripped.content).toBe(stripReasoningFromMessageForRouting(legacy).content);
		expect(stripped.contentShape).toBeUndefined();
	});

	it("renders the same completion prompt", async () => {
		const model = {
			parameters: {},
			chatPromptRender: ({ messages }: { messages: Array<{ content: string }> }) =>
				messages.map((m) => m.content).join("|"),
		} as unknown as BackendModel;
		expect(await buildPrompt({ messages: history(rounds), model })).toBe(
			await buildPrompt({ messages: history(legacy), model })
		);
	});
});

it("finds an artifact that only a preamble holds", () => {
	const { rounds } = cases.find((c) => c.name === "artifact in a preamble") ?? cases[0];
	expect(rounds.content).not.toContain("<artifact");
	expect(collectArtifacts([rounds]).artifacts.size).toBe(1);
});
