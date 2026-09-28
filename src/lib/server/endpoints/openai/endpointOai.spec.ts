import { describe, expect, it, vi } from "vitest";
import type { MessageFile } from "$lib/types/Message";
import { CLIPBOARD_MIME } from "$lib/server/textGeneration/utils/attachmentBudget";

const mocks = vi.hoisted(() => ({
	create: vi.fn(async () => (async function* () {})()),
}));

vi.mock("openai", async (importOriginal) => ({
	...(await importOriginal<typeof import("openai")>()),
	OpenAI: class {
		completions = { create: mocks.create };
	},
}));

const { endpointOai } = await import("./endpointOai");

const file = (name: string, text: string, mime: string): MessageFile => ({
	type: "base64",
	name,
	value: Buffer.from(text).toString("base64"),
	mime,
});

describe("legacy completions", () => {
	it("renders pasted text and text files into the prompt within the attachment budget", async () => {
		const endpoint = await endpointOai({
			type: "openai",
			completion: "completions",
			model: {
				id: "m",
				name: "m",
				parameters: {},
				chatPromptRender: ({ messages }: { messages: Array<{ role: string; content: string }> }) =>
					messages.map((m) => `${m.role}: ${m.content}`).join("\n"),
			},
		});
		const onAttachments = vi.fn();

		await endpoint({
			messages: [
				{
					from: "user",
					content: "what is this",
					files: [
						file("notes.txt", "alpha", "text/plain"),
						file("Pasted Content", "pasted words", CLIPBOARD_MIME),
					],
				},
			],
			locals: undefined,
			onAttachments,
		});

		const [body] = mocks.create.mock.calls[0] as unknown as [{ prompt: string }];
		expect(body.prompt).toBe(
			'user: <document name="notes.txt" type="text/plain">\nalpha\n</document>\n\npasted words\n\nwhat is this'
		);
		expect(onAttachments).toHaveBeenCalledWith(
			expect.objectContaining({
				texts: [
					expect.objectContaining({ name: "notes.txt", shown: 5 }),
					expect.objectContaining({ name: "Pasted Content", shown: 12 }),
				],
			})
		);
	});
});
