import { describe, it, expect } from "vitest";
import { chatMessagesToResponsesInput } from "./endpointResponses";
import type OpenAI from "openai";

describe("chatMessagesToResponsesInput", () => {
	it("should extract system messages into instructions", () => {
		const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
			{ role: "system", content: "You are a helpful assistant." },
			{ role: "user", content: "Hello" },
		];

		const { input, instructions } = chatMessagesToResponsesInput(messages);

		expect(instructions).toBe("You are a helpful assistant.");
		expect(input).toHaveLength(1);
		expect(input[0]).toEqual({ role: "user", content: "Hello" });
	});

	it("should combine multiple system messages", () => {
		const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
			{ role: "system", content: "Rule 1" },
			{ role: "system", content: "Rule 2" },
			{ role: "user", content: "Hi" },
		];

		const { instructions } = chatMessagesToResponsesInput(messages);
		expect(instructions).toBe("Rule 1\n\nRule 2");
	});

	it("should return undefined instructions when no system messages", () => {
		const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
			{ role: "user", content: "Hello" },
			{ role: "assistant", content: "Hi there!" },
		];

		const { input, instructions } = chatMessagesToResponsesInput(messages);

		expect(instructions).toBeUndefined();
		expect(input).toHaveLength(2);
		expect(input[0]).toEqual({ role: "user", content: "Hello" });
		expect(input[1]).toEqual({ role: "assistant", content: "Hi there!" });
	});

	it("should convert image_url parts to input_image", () => {
		const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
			{
				role: "user",
				content: [
					{ type: "text", text: "What is in this image?" },
					{
						type: "image_url",
						image_url: { url: "data:image/jpeg;base64,abc123", detail: "high" },
					},
				],
			},
		];

		const { input } = chatMessagesToResponsesInput(messages);

		expect(input).toHaveLength(1);
		const msg = input[0] as { role: string; content: unknown[] };
		expect(msg.role).toBe("user");
		expect(msg.content).toHaveLength(2);
		expect(msg.content[0]).toEqual({ type: "input_text", text: "What is in this image?" });
		expect(msg.content[1]).toEqual({
			type: "input_image",
			image_url: "data:image/jpeg;base64,abc123",
			detail: "high",
		});
	});

	it("should default image detail to auto", () => {
		const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
			{
				role: "user",
				content: [
					{
						type: "image_url",
						image_url: { url: "data:image/png;base64,xyz" },
					},
				],
			},
		];

		const { input } = chatMessagesToResponsesInput(messages);

		const msg = input[0] as { role: string; content: unknown[] };
		expect(msg.content[0]).toEqual({
			type: "input_image",
			image_url: "data:image/png;base64,xyz",
			detail: "auto",
		});
	});

	it("should handle a multi-turn conversation", () => {
		const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
			{ role: "system", content: "Be concise." },
			{ role: "user", content: "What is 2+2?" },
			{ role: "assistant", content: "4" },
			{ role: "user", content: "And 3+3?" },
		];

		const { input, instructions } = chatMessagesToResponsesInput(messages);

		expect(instructions).toBe("Be concise.");
		expect(input).toHaveLength(3);
		expect(input[0]).toEqual({ role: "user", content: "What is 2+2?" });
		expect(input[1]).toEqual({ role: "assistant", content: "4" });
		expect(input[2]).toEqual({ role: "user", content: "And 3+3?" });
	});
});
