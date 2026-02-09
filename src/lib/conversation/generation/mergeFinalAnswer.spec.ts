import { describe, expect, it } from "vitest";
import { mergeFinalAnswer, mergeFinalAnswerWithPrefix } from "./mergeFinalAnswer";

describe("mergeFinalAnswer", () => {
	it("uses final text when interrupted and no content was streamed", () => {
		expect(
			mergeFinalAnswer({
				currentContent: "",
				finalText: "partial",
				interrupted: true,
				hadTools: false,
			})
		).toBe("partial");
	});

	it("preserves streamed content when interrupted", () => {
		expect(
			mergeFinalAnswer({
				currentContent: "already streamed",
				finalText: "provider final",
				interrupted: true,
				hadTools: false,
			})
		).toBe("already streamed");
	});

	it("replaces content when tools were not used", () => {
		expect(
			mergeFinalAnswer({
				currentContent: "streamed",
				finalText: "authoritative final",
				hadTools: false,
			})
		).toBe("authoritative final");
	});

	it("uses final text directly when tools were used but nothing was streamed", () => {
		expect(
			mergeFinalAnswer({
				currentContent: "",
				finalText: "tool final",
				hadTools: true,
			})
		).toBe("tool final");
	});

	it("keeps existing content when tool run already streamed the final text", () => {
		expect(
			mergeFinalAnswer({
				currentContent: "hello world   ",
				finalText: "world",
				hadTools: true,
			})
		).toBe("hello world   ");

		expect(
			mergeFinalAnswer({
				currentContent: "hello world",
				finalText: "world",
				hadTools: true,
			})
		).toBe("hello world");
	});

	it("uses final text when it already includes the streamed prefix", () => {
		expect(
			mergeFinalAnswer({
				currentContent: "hello world   ",
				finalText: "hello world and more",
				hadTools: true,
			})
		).toBe("hello world and more");

		expect(
			mergeFinalAnswer({
				currentContent: "hello",
				finalText: "hello world",
				hadTools: true,
			})
		).toBe("hello world");
	});

	it("merges streamed and final text with a paragraph gap when needed", () => {
		expect(
			mergeFinalAnswer({
				currentContent: "draft",
				finalText: "follow-up",
				hadTools: true,
			})
		).toBe("draft\n\nfollow-up");

		expect(
			mergeFinalAnswer({
				currentContent: "draft\n\n",
				finalText: "follow-up",
				hadTools: true,
			})
		).toBe("draft\n\nfollow-up");

		expect(
			mergeFinalAnswer({
				currentContent: "draft",
				finalText: "\nfollow-up",
				hadTools: true,
			})
		).toBe("draft\nfollow-up");
	});

	it("handles empty final text in tool mode", () => {
		expect(
			mergeFinalAnswer({
				currentContent: "draft",
				finalText: "",
				hadTools: true,
			})
		).toBe("draft\n\n");
	});

	it("defaults undefined final text to empty string", () => {
		expect(
			mergeFinalAnswer({
				currentContent: "draft",
				hadTools: false,
			})
		).toBe("");
	});
});

describe("mergeFinalAnswerWithPrefix", () => {
	it("merges only the generated suffix and keeps prefix untouched", () => {
		expect(
			mergeFinalAnswerWithPrefix({
				prefixContent: "[prefix]",
				currentContent: "[prefix]draft",
				finalText: "final",
				hadTools: true,
			})
		).toBe("[prefix]draft\n\nfinal");
	});

	it("falls back when current content does not start with prefix", () => {
		expect(
			mergeFinalAnswerWithPrefix({
				prefixContent: "[prefix]",
				currentContent: "draft",
				finalText: "final",
				hadTools: false,
			})
		).toBe("[prefix]final");
	});
});
