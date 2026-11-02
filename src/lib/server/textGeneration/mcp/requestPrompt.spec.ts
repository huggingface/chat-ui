import { describe, expect, it } from "vitest";
import { completionSettings } from "./requestPrompt";

describe("completionSettings", () => {
	const targetModel = {
		id: "deepseek-ai/DeepSeek-V4.1-Flash-1017",
		name: "deepseek-ai/DeepSeek-V4.1-Flash-1017",
		parameters: { max_tokens: 49152 },
		providerMaxTokens: { scaleway: 32768 },
	};

	it("caps max_tokens to the provider's own limit", () => {
		const maxTokens = (provider?: string) =>
			completionSettings({ targetModel, mlAssistant: false, provider }).maxTokens;

		expect(maxTokens("novita")).toBe(49152);
		expect(maxTokens("scaleway")).toBe(32768);
		expect(maxTokens(undefined)).toBe(32768);
	});
});
