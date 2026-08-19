import { describe, expect, test } from "vitest";
import { mergeFinalAnswerContent } from "./mergeFinalAnswer";

const merge = mergeFinalAnswerContent;

describe("mergeFinalAnswerContent — no tools", () => {
	test("the provider's final text is authoritative, replacing streamed content", () => {
		expect(
			merge({ existing: "partial", finalText: "final", hadTools: false, isInterrupted: false })
		).toBe("final");
	});

	test("an empty final text clears the content", () => {
		expect(
			merge({ existing: "partial", finalText: "", hadTools: false, isInterrupted: false })
		).toBe("");
	});

	test("adopts the final text even when nothing was streamed", () => {
		expect(merge({ existing: "", finalText: "final", hadTools: false, isInterrupted: false })).toBe(
			"final"
		);
	});
});

describe("mergeFinalAnswerContent — interrupted", () => {
	test("nothing streamed falls back to the final text", () => {
		expect(
			merge({ existing: "", finalText: "clamped", hadTools: false, isInterrupted: true })
		).toBe("clamped");
	});

	test("adopts the final text when it is a prefix of what we streamed (server clamp)", () => {
		// The server clamped the persisted text back to the stop point; adopt it so
		// this view matches every other view.
		expect(
			merge({
				existing: "hello world extra",
				finalText: "hello world",
				hadTools: false,
				isInterrupted: true,
			})
		).toBe("hello world");
	});

	test("keeps our streamed content when the final text is not a prefix", () => {
		// A continue flow may return only post-prefix text; do not clobber what we have.
		expect(
			merge({
				existing: "hello world",
				finalText: "different",
				hadTools: false,
				isInterrupted: true,
			})
		).toBe("hello world");
	});

	test("an empty final text leaves streamed content untouched", () => {
		expect(
			merge({ existing: "streamed so far", finalText: "", hadTools: false, isInterrupted: true })
		).toBe("streamed so far");
	});

	test("interrupted takes precedence over tools", () => {
		expect(merge({ existing: "abc", finalText: "abc", hadTools: true, isInterrupted: true })).toBe(
			"abc"
		);
	});
});

describe("mergeFinalAnswerContent — tools (case A: already streamed)", () => {
	test("keeps existing when it ends with the final text verbatim", () => {
		expect(
			merge({
				existing: "story then answer",
				finalText: "answer",
				hadTools: true,
				isInterrupted: false,
			})
		).toBe("story then answer");
	});

	test("keeps existing when it ends with the final text modulo surrounding whitespace", () => {
		expect(
			merge({
				existing: "story\nanswer  ",
				finalText: "  answer",
				hadTools: true,
				isInterrupted: false,
			})
		).toBe("story\nanswer  ");
	});
});

describe("mergeFinalAnswerContent — tools (case B: final includes streamed prefix)", () => {
	test("uses the final text verbatim when it starts with what we streamed", () => {
		expect(
			merge({
				existing: "The story",
				finalText: "The story and its caption",
				hadTools: true,
				isInterrupted: false,
			})
		).toBe("The story and its caption");
	});

	test("uses the final text when it starts with the streamed prefix modulo whitespace", () => {
		expect(
			merge({
				existing: "The story  ",
				finalText: "The story continues",
				hadTools: true,
				isInterrupted: false,
			})
		).toBe("The story continues");
	});
});

describe("mergeFinalAnswerContent — tools (case C: distinct, join with a gap)", () => {
	test("joins distinct pre-tool and post-tool text with a paragraph break", () => {
		expect(
			merge({
				existing: "A story.",
				finalText: "An image caption.",
				hadTools: true,
				isInterrupted: false,
			})
		).toBe("A story.\n\nAn image caption.");
	});

	test("does not add a gap when existing already ends with a blank line", () => {
		expect(
			merge({
				existing: "A story.\n\n",
				finalText: "Caption.",
				hadTools: true,
				isInterrupted: false,
			})
		).toBe("A story.\n\nCaption.");
	});

	test("does not add a gap when the final text already starts with a newline", () => {
		expect(
			merge({ existing: "A story.", finalText: "\nCaption.", hadTools: true, isInterrupted: false })
		).toBe("A story.\nCaption.");
	});

	test("falls back to the final text when nothing was streamed before the tools", () => {
		expect(
			merge({ existing: "", finalText: "Only the caption.", hadTools: true, isInterrupted: false })
		).toBe("Only the caption.");
	});
});
