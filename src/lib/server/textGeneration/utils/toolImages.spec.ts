import { describe, expect, it, vi } from "vitest";
import type { OpenAI } from "openai";
import type { makeImageProcessor } from "$lib/server/endpoints/images";
import { groupRounds } from "./historyWindow";
import { injectSessionState } from "$lib/server/mlRegistry/stateBlock";
import {
	isToolImagesMessage,
	lastUserMessageIndex,
	limitToolImages,
	makeToolImageReader,
	renderToolImages,
	TOOL_IMAGES_HEADER,
	toolImageBlocks,
	withToolImages,
} from "./toolImages";

type ChatMessageParam = OpenAI.Chat.Completions.ChatCompletionMessageParam;

const passThrough = vi.fn(async (file: { value: string; mime: string }) => ({
	image: Buffer.from(file.value, "base64"),
	mime: file.mime,
})) as unknown as ReturnType<typeof makeImageProcessor>;

const image = (data: string, mimeType = "image/png") => ({ type: "image", data, mimeType });
const url = (data: string, mime = "image/png") => `data:${mime};base64,${data}`;
const part = (data: string) => ({
	part: { type: "image_url" as const, image_url: { url: url(data) } },
});

const toolMessage = (id: string, content: string): ChatMessageParam => ({
	role: "tool",
	tool_call_id: id,
	content,
});

describe("toolImageBlocks", () => {
	it("keeps inline and stored images, drops text, other blocks and malformed images", () => {
		expect(
			toolImageBlocks([
				{ type: "text", text: "hi" },
				image("AAA"),
				{ type: "image", sha: "abc", mimeType: "image/jpeg" },
				{ type: "image", mimeType: "image/png" },
				{ type: "image", data: "BBB", mimeType: "application/pdf" },
				{ type: "resource", resource: { uri: "x" } },
				null,
			])
		).toEqual([
			{ mimeType: "image/png", data: "AAA" },
			{ mimeType: "image/jpeg", sha: "abc" },
		]);
		expect(toolImageBlocks(undefined)).toEqual([]);
	});
});

describe("renderToolImages", () => {
	it("numbers the shown images across the round and labels each with its call", () => {
		const { notes, message } = renderToolImages([
			{ toolCallId: "a", tool: "hf_fs", images: [part("A1"), part("A2")] },
			{ toolCallId: "b", tool: "hf_fs", images: [] },
			{ toolCallId: "c", tool: "hf_fs", images: [part("C1"), { missing: "failed" }] },
		]);
		expect(notes.get("a")).toBe(
			"[Images 1–2 from this result are in the message after these tool results.]"
		);
		expect(notes.has("b")).toBe(false);
		expect(notes.get("c")).toBe(
			"[Image 3 from this result is in the message after these tool results.]\n" +
				"[This result included an image that could not be shown to you, so you do not know what it shows. Do not describe it or draw conclusions from it; if its contents matter, say you could not view it.]"
		);
		expect(message?.content).toEqual([
			{ type: "text", text: TOOL_IMAGES_HEADER },
			{ type: "text", text: "Image 1, from hf_fs call a:" },
			part("A1").part,
			{ type: "text", text: "Image 2, from hf_fs call a:" },
			part("A2").part,
			{ type: "text", text: "Image 3, from hf_fs call c:" },
			part("C1").part,
		]);
	});

	it("sends no message when nothing can be shown", () => {
		const { notes, message } = renderToolImages([
			{ toolCallId: "a", tool: "hf_fs", images: [{ missing: "hidden" }, { missing: "hidden" }] },
		]);
		expect(message).toBeUndefined();
		expect(notes.get("a")).toMatch(
			/^\[This result included 2 images that were not passed to you, so you do not know what they show\. Do not describe them/
		);
	});
});

describe("withToolImages", () => {
	const sources = [
		{ toolCallId: "a", tool: "hf_fs", blocks: [{ mimeType: "image/png", data: "AAA" }] },
	];

	it("follows the round's results with the images for a vision model", async () => {
		const out = await withToolImages([toolMessage("a", "Attached sheet.png")], sources, {
			multimodal: true,
			imageProcessor: passThrough,
			read: makeToolImageReader(),
			maxImages: 8,
		});
		expect(out).toHaveLength(2);
		expect(out[0]).toEqual(
			toolMessage(
				"a",
				"Attached sheet.png\n\n[Image 1 from this result is in the message after these tool results.]"
			)
		);
		expect(isToolImagesMessage(out[1])).toBe(true);
		expect(JSON.stringify(out[1])).toContain(url("AAA"));
	});

	it("tells a model without image input it cannot see the image, and never reads it", async () => {
		const read = vi.fn();
		const out = await withToolImages([toolMessage("a", "")], sources, {
			multimodal: false,
			imageProcessor: passThrough,
			read,
			maxImages: 8,
		});
		expect(out).toEqual([
			toolMessage(
				"a",
				"[This result included an image that was not passed to you, so you do not know what it shows. Do not describe it or draw conclusions from it; if its contents matter, say you could not view it.]"
			),
		]);
		expect(read).not.toHaveBeenCalled();
	});

	it("says the image could not be shown when it does not decode", async () => {
		const failing = (async () => {
			throw new Error("Input buffer contains unsupported image format");
		}) as unknown as ReturnType<typeof makeImageProcessor>;
		const out = await withToolImages([toolMessage("a", "ok")], sources, {
			multimodal: true,
			imageProcessor: failing,
			read: makeToolImageReader(),
			maxImages: 8,
		});
		expect(out).toHaveLength(1);
		expect(String(out[0].content)).toMatch(/could not be shown to you/);
	});

	it("decodes only the newest images a request can send, and names the rest", async () => {
		const processor = vi.fn(passThrough);
		const out = await withToolImages(
			[toolMessage("a", "first"), toolMessage("b", "second")],
			[
				{ toolCallId: "a", tool: "hf_fs", blocks: [{ mimeType: "image/png", data: "AAAA" }] },
				{
					toolCallId: "b",
					tool: "hf_fs",
					blocks: [
						{ mimeType: "image/png", data: "BBBB" },
						{ mimeType: "image/png", data: "CCCC" },
					],
				},
			],
			{ multimodal: true, imageProcessor: processor, read: makeToolImageReader(), maxImages: 2 }
		);
		expect(processor).toHaveBeenCalledTimes(2);
		expect(String(out[0].content)).toMatch(/no longer shown to you/);
		expect(String(out[1].content)).toMatch(/Images 1.2 from this result/);
		expect(JSON.stringify(out[2])).not.toContain(url("AAAA"));
	});

	it("leaves a round without images untouched", async () => {
		const messages = [toolMessage("a", "text")];
		const out = await withToolImages(messages, [], {
			multimodal: true,
			imageProcessor: passThrough,
			read: makeToolImageReader(),
			maxImages: 8,
		});
		expect(out).toBe(messages);
	});
});

describe("the tool images message in the history", () => {
	const round: ChatMessageParam[] = [
		{
			role: "assistant",
			tool_calls: [{ id: "a", type: "function", function: { name: "hf_fs", arguments: "{}" } }],
		},
		toolMessage("a", "[Image 1 from this result is in the message after these tool results.]"),
		{
			role: "user",
			content: [
				{ type: "text", text: TOOL_IMAGES_HEADER },
				{ type: "image_url", image_url: { url: url("AAA") } },
			],
		},
	];

	it("stays in its round, so the window never keeps an image without its call", () => {
		const groups = groupRounds([{ role: "user", content: "brief" }, ...round]);
		expect(groups).toHaveLength(2);
		expect(groups[1]).toEqual(round);
	});

	it("is never taken for the user's own last message", () => {
		const messages: ChatMessageParam[] = [{ role: "user", content: "brief" }, ...round];
		expect(lastUserMessageIndex(messages)).toBe(0);
		expect(injectSessionState(messages, "STATE")[0]).toEqual({
			role: "user",
			content: "brief\n\nSTATE",
		});
	});
});

describe("limitToolImages", () => {
	const toolImages = (...data: string[]): ChatMessageParam => ({
		role: "user",
		content: [
			{ type: "text", text: TOOL_IMAGES_HEADER },
			...data.flatMap((d, i) => [
				{ type: "text" as const, text: `Image ${i + 1}, from hf_fs call ${d}:` },
				{ type: "image_url" as const, image_url: { url: url(d) } },
			]),
		],
	});
	const caps = { maxImages: 3, maxBytes: 1_000_000 };

	it("returns the same list when everything fits", () => {
		const messages = [toolImages("a", "b"), toolImages("c")];
		expect(limitToolImages(messages, caps)).toBe(messages);
	});

	it("cuts the oldest tool images first, after counting the user's own", () => {
		const upload: ChatMessageParam = {
			role: "user",
			content: [
				{ type: "text", text: "look" },
				{ type: "image_url", image_url: { url: url("u") } },
			],
		};
		const out = limitToolImages([upload, toolImages("a", "b"), toolImages("c")], caps);
		expect(out[0]).toBe(upload);
		expect(out[2]).toEqual(toolImages("c"));
		expect(out[1].content).toEqual([
			{ type: "text", text: TOOL_IMAGES_HEADER },
			{
				type: "text",
				text: "[Image 1, from hf_fs call a is no longer attached, to keep the request small. Attach it again if you need to look.]",
			},
			{ type: "text", text: "Image 2, from hf_fs call b:" },
			{ type: "image_url", image_url: { url: url("b") } },
		]);
	});

	it("always sends the newest tool image, whatever the user attached", () => {
		const out = limitToolImages([toolImages("a"), toolImages("b")], {
			maxImages: 0,
			maxBytes: 0,
		});
		expect(JSON.stringify(out[1])).toContain(url("b"));
		expect(JSON.stringify(out[0])).not.toContain(url("a"));
	});

	it("holds tool images to the byte cap", () => {
		const big = "x".repeat(600);
		const out = limitToolImages([toolImages(big), toolImages("small")], {
			maxImages: 10,
			maxBytes: 500,
		});
		expect(JSON.stringify(out[0])).not.toContain("image_url");
		expect(JSON.stringify(out[1])).toContain(url("small"));
	});
});
