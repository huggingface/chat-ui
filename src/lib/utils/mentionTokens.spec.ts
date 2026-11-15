import { describe, expect, it } from "vitest";
import {
	findMentionTokens,
	MENTION_MARK,
	mentionToken,
	plainMentions,
	stripOrphanMentionMarks,
} from "./mentionTokens";

describe("mention tokens", () => {
	const text = `Why does ${mentionToken("deepseek-ai/DeepSeek-V4.1-Flash")} beat ${mentionToken("Qwen/Qwen3.8-27B")}?`;

	it("finds each accepted repo as one span", () => {
		expect(findMentionTokens(text).map((t) => t.text)).toEqual([
			"@deepseek-ai/DeepSeek-V4.1-Flash",
			"@Qwen/Qwen3.8-27B",
		]);
		expect(findMentionTokens("a typed @org/name stays plain")).toEqual([]);
	});

	it("reads as plain @-mentions outside the composer", () => {
		expect(plainMentions(text)).toBe(
			"Why does @deepseek-ai/DeepSeek-V4.1-Flash beat @Qwen/Qwen3.8-27B?"
		);
	});

	it("keeps the words of a mention cut in half, without its stray mark", () => {
		const cut = text.slice(0, text.indexOf(MENTION_MARK) + 6);
		expect(stripOrphanMentionMarks(cut)).not.toContain(MENTION_MARK);
		expect(stripOrphanMentionMarks(text)).toBe(text);
	});
});
