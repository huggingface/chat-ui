import { describe, expect, it } from "vitest";
import { BadRequestError } from "openai";
import type { OpenAI } from "openai";
import type { MessageFile } from "$lib/types/Message";
import type { makeImageProcessor } from "$lib/server/endpoints/images";
import { prepareHistory, type HistoryMessage } from "./prepareFiles";
import {
	AttachmentOverflowError,
	budgetNotice,
	canCutAttachments,
	CLIPBOARD_MIME,
	FILE_TEXT_BUDGET_CHARS,
	isContextOverflowError,
	MAX_IMAGE_BYTES,
	retryNotice,
	SHORT_HEAD_CHARS,
	truncateText,
	type AttachmentReport,
} from "./attachmentBudget";

type Sent = OpenAI.Chat.Completions.ChatCompletionMessageParam;

const WINDOW_1M = 1_048_576;

/** passes the bytes through so a test sets each image size by its value */
const passThrough = (async (file: MessageFile) => ({
	mime: "image/png",
	image: Buffer.from(file.value, "base64"),
})) as unknown as ReturnType<typeof makeImageProcessor>;

const noImages = (() => {
	throw new Error("imageProcessor should not be called in these tests");
}) as unknown as ReturnType<typeof makeImageProcessor>;

const textFile = (name: string, text: string, mime = "text/csv"): MessageFile => ({
	type: "base64",
	name,
	value: Buffer.from(text).toString("base64"),
	mime,
});

const image = (name: string, bytes = 16): MessageFile => ({
	type: "base64",
	name,
	value: Buffer.alloc(bytes, 7).toString("base64"),
	mime: "image/png",
});

function syntheticCsv(chars: number): string {
	const lines = ["id,user,score,created_at,comment"];
	let length = lines[0].length + 1;
	for (let i = 0; length < chars; i += 1) {
		const line = `${i},user_${i % 997},${((i * 7919) % 10_000) / 100},2026-09-${String((i % 28) + 1).padStart(2, "0")},"row ${i} of the export"`;
		lines.push(line);
		length += line.length + 1;
	}
	return lines.join("\n") + "\n";
}

const textOf = (message: Sent | undefined): string => {
	const content = message?.content;
	if (typeof content === "string") return content;
	return (content ?? []).map((part) => ("text" in part ? part.text : "")).join("");
};

const documentBody = (text: string) =>
	/<document name="[^"]*" type="[^"]*">\n([\s\S]*?)\n<\/document>/.exec(text)?.[1] ?? "";

const MARKER =
	/\n\[… truncated: showing ([\d,]+) of ([\d,]+) characters of (.+?)\. Ask [^\]]*\]\n?/;

const count = (formatted: string) => Number(formatted.replaceAll(",", ""));

describe("per-file text budget", () => {
	it("keeps the head and tail of a file on line boundaries, with the counts in the marker", () => {
		const csv = syntheticCsv(400_000);
		const { text, shown } = truncateText(csv, "data.csv", { head: 100_000, tail: 50_000 }, false);

		const marker = MARKER.exec(text);
		expect(marker).not.toBeNull();
		const [head, tail] = text.split(marker?.[0] ?? "");
		expect(csv.startsWith(head)).toBe(true);
		expect(csv[head.length]).toBe("\n");
		expect(csv.endsWith(tail)).toBe(true);
		expect(csv[csv.length - tail.length - 1]).toBe("\n");
		expect(head.split("\n")[0]).toBe("id,user,score,created_at,comment");
		expect(shown).toBe(head.length + tail.length);
		expect(count(marker?.[1] ?? "")).toBe(shown);
		expect(count(marker?.[2] ?? "")).toBe(csv.length);
		expect(shown).toBeLessThanOrEqual(150_000);
		expect(shown).toBeGreaterThan(149_000);
	});

	it("words the marker for the mode", () => {
		const long = "a\n".repeat(10_000);
		const chat = truncateText(long, "notes.txt", { head: 100, tail: 0 }, false).text;
		const ml = truncateText(long, "notes.txt", { head: 100, tail: 0 }, true).text;

		expect(chat).toContain(
			"[… truncated: showing 99 of 20,000 characters of notes.txt. Ask for a specific part if you need the rest.]"
		);
		expect(ml).toContain(
			"[… truncated: showing 99 of 20,000 characters of notes.txt. Ask for a specific part, or load the file in a job or sandbox for the rest.]"
		);
	});

	it("cuts a file without line breaks at the budget without splitting a character", () => {
		const minified = "<p>" + "😀".repeat(100_000) + "</p>";
		const { text, shown } = truncateText(minified, "page.html", { head: 1_001, tail: 501 }, false);

		expect(shown).toBeGreaterThan(1_400);
		expect(text).not.toMatch(
			/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/
		);
		expect(text.startsWith("<p>😀")).toBe(true);
		expect(text.endsWith("😀</p>")).toBe(true);
	});

	it("sends a file that fits untouched", () => {
		const csv = syntheticCsv(10_000);
		expect(truncateText(csv, "data.csv", { head: 100_000, tail: 50_000 }, false)).toEqual({
			text: csv,
			shown: csv.length,
		});
	});

	it("gives the same output for the same file every time", () => {
		const csv = syntheticCsv(300_000);
		const keep = { head: 100_000, tail: 50_000 };
		expect(truncateText(csv, "data.csv", keep, true)).toEqual(
			truncateText(csv, "data.csv", keep, true)
		);
	});
});

describe("attachments in the prompt", () => {
	it("sends an 8 MB CSV brief as about 50k tokens instead of 2.7M", async () => {
		const csv = syntheticCsv(8 * 1024 * 1024);
		// alone the file is past a million token window at 3 chars a token, the shape of the provider 400s
		expect(csv.length / 3).toBeGreaterThan(WINDOW_1M);

		const { messages, attachments } = await prepareHistory(
			[{ from: "user", content: "summarise this", files: [textFile("data.csv", csv)] }],
			noImages,
			false,
			{ contextLengthTokens: WINDOW_1M, slidingWindow: true }
		);

		const text = textOf(messages[0]);
		expect(text.length).toBeLessThan(FILE_TEXT_BUDGET_CHARS + 500);
		expect(text.endsWith("</document>\n\nsummarise this")).toBe(true);
		expect(documentBody(text)).toMatch(MARKER);
		expect(attachments.texts).toEqual([
			{ index: 0, name: "data.csv", total: csv.length, shown: expect.any(Number) },
		]);
		expect(budgetNotice(attachments)).toMatch(
			/^data\.csv is too long to send whole: the model sees 1\d\d,\d{3} of its 8,\d{3},\d{3} characters, from the start and the end\.$/
		);
	});

	it("shrinks the oldest files first once the request is over its share of the window", async () => {
		const messages: HistoryMessage[] = Array.from({ length: 6 }, (_, i) => [
			{
				from: "user" as const,
				content: `part ${i}`,
				files: [textFile(`p${i}.csv`, syntheticCsv(400_000))],
			},
			{ from: "assistant" as const, content: `read ${i}` },
		])
			.flat()
			.slice(0, -1);

		const { attachments } = await prepareHistory(messages, noImages, false, {
			contextLengthTokens: WINDOW_1M,
		});

		const shown = attachments.texts.map((t) => t.shown);
		expect(shown[0]).toBeLessThanOrEqual(SHORT_HEAD_CHARS);
		expect(shown.slice(1).every((n) => n > 149_000)).toBe(true);
	});

	it("never shrinks the newest message's files below the per-file budget", async () => {
		const { attachments } = await prepareHistory(
			[
				{ from: "user", content: "first", files: [textFile("a.csv", syntheticCsv(400_000))] },
				{ from: "assistant", content: "ok" },
				{ from: "user", content: "second", files: [textFile("b.csv", syntheticCsv(400_000))] },
			],
			noImages,
			false,
			// a quarter of this window holds less than two full files
			{ contextLengthTokens: 200_000 }
		);

		const [older, newest] = attachments.texts;
		expect(older.shown).toBeLessThanOrEqual(SHORT_HEAD_CHARS);
		expect(newest.shown).toBeGreaterThan(140_000);
	});

	it("keeps an older file's text unchanged when later messages arrive within the budget", async () => {
		const brief: HistoryMessage = {
			from: "user",
			content: "look",
			files: [textFile("data.csv", syntheticCsv(1_000_000))],
		};
		const options = { contextLengthTokens: WINDOW_1M, slidingWindow: true };
		const first = await prepareHistory([brief], noImages, false, options);
		const later = await prepareHistory(
			[
				brief,
				{ from: "assistant", content: "seen" },
				{ from: "user", content: "and this", files: [textFile("more.csv", syntheticCsv(200_000))] },
			],
			noImages,
			false,
			options
		);

		expect(textOf(later.messages[0])).toBe(textOf(first.messages[0]));
		expect(JSON.stringify(later.messages)).toBe(
			JSON.stringify(
				(
					await prepareHistory(
						[
							brief,
							{ from: "assistant", content: "seen" },
							{
								from: "user",
								content: "and this",
								files: [textFile("more.csv", syntheticCsv(200_000))],
							},
						],
						noImages,
						false,
						options
					)
				).messages
			)
		);
	});

	it("inlines pasted text as before when it fits and cuts it like a file when it does not", async () => {
		const paste = (text: string): MessageFile => ({
			...textFile("Pasted Content", text, CLIPBOARD_MIME),
		});
		const { messages } = await prepareHistory(
			[
				{
					from: "user",
					content: "compare",
					files: [textFile("a.txt", "alpha", "text/plain"), paste("pasted words")],
				},
				{ from: "assistant", content: "ok" },
				{ from: "user", content: "and", files: [paste("x\n".repeat(200_000))] },
			],
			noImages,
			false,
			{ contextLengthTokens: WINDOW_1M }
		);

		expect(textOf(messages[0])).toBe(
			'<document name="a.txt" type="text/plain">\nalpha\n</document>\n\npasted words\n\ncompare'
		);
		expect(textOf(messages[2])).toMatch(MARKER);
		expect(textOf(messages[2])).toContain("characters of Pasted Content.");
	});

	it("cuts every file to a short head and drops older images on the minimal retry", async () => {
		const { messages, attachments } = await prepareHistory(
			[
				{
					from: "user",
					content: "old",
					files: [textFile("a.csv", syntheticCsv(50_000)), image("old.png")],
				},
				{ from: "assistant", content: "ok" },
				{
					from: "user",
					content: "new",
					files: [textFile("b.csv", syntheticCsv(50_000)), image("new.png")],
				},
			],
			passThrough,
			true,
			{ contextLengthTokens: WINDOW_1M, attachments: "minimal" }
		);

		expect(attachments.texts.every((t) => t.shown <= SHORT_HEAD_CHARS)).toBe(true);
		expect(attachments.images).toEqual([
			{ index: 0, name: "old.png", sent: false },
			{ index: 2, name: "new.png", sent: true },
		]);
		expect(textOf(messages[0])).toContain("[image omitted: old.png]");
		expect(retryNotice(attachments)).toMatch(
			/^The model refused the request as too large, so it was sent again with attachments cut: a\.csv to its first [\d,]+ of 50,\d{3} characters; b\.csv to its first [\d,]+ of 50,\d{3} characters; 1 image left out\.$/
		);
	});
});

describe("images", () => {
	it("sends the 8 most recent images and names the rest", async () => {
		const history: HistoryMessage[] = [0, 1, 2].flatMap((m) => [
			{
				from: "user" as const,
				content: `batch ${m}`,
				files: [0, 1, 2, 3].map((i) => image(`img${m * 4 + i}.png`)),
			},
			{ from: "assistant" as const, content: "seen" },
		]);
		history.pop();

		const { messages, attachments } = await prepareHistory(history, passThrough, true);

		expect(attachments.images.filter((i) => i.sent).map((i) => i.name)).toEqual(
			["img4", "img5", "img6", "img7", "img8", "img9", "img10", "img11"].map((n) => `${n}.png`)
		);
		expect(messages[0].content).toBe(
			"batch 0\n\n[image omitted: img0.png]\n[image omitted: img1.png]\n[image omitted: img2.png]\n[image omitted: img3.png]"
		);
		expect(Array.isArray(messages[2].content)).toBe(true);
		expect(budgetNotice(attachments)).toBeUndefined();
	});

	it("keeps the image data of a request under the byte cap, newest first", async () => {
		const megabyte = 1_000_000;
		const history: HistoryMessage[] = [
			{
				from: "user",
				content: "screens",
				files: Array.from({ length: 6 }, (_, i) => image(`shot${i}.png`, megabyte)),
			},
		];

		const { attachments } = await prepareHistory(history, passThrough, true);

		const sent = attachments.images.filter((i) => i.sent);
		expect(sent.map((i) => i.name)).toEqual(["shot3.png", "shot4.png", "shot5.png"]);
		expect(sent.length * Math.ceil(megabyte / 3) * 4).toBeLessThanOrEqual(MAX_IMAGE_BYTES);
		expect(budgetNotice(attachments)).toBe(
			"3 images left out to keep the request within limits: shot0.png, shot1.png, shot2.png."
		);
	});

	it("always sends the newest image, whatever its size", async () => {
		const { attachments } = await prepareHistory(
			[{ from: "user", content: "big", files: [image("huge.png", MAX_IMAGE_BYTES)] }],
			passThrough,
			true
		);
		expect(attachments.images).toEqual([{ index: 0, name: "huge.png", sent: true }]);
	});
});

describe("provider size refusals", () => {
	it.each([
		[
			"a context-length 400",
			new BadRequestError(
				400,
				{
					message:
						"This model's maximum context length is 1048576 tokens. However, you requested 2712331 tokens.",
				},
				undefined,
				{}
			),
		],
		["a 413 status", Object.assign(new Error("Payload Too Large"), { status: 413 })],
		["a 413 from the router endpoint", Object.assign(new Error("too big"), { statusCode: 413 })],
		["request entity too large", new Error("413 Request Entity Too Large")],
		["context_length_exceeded", new Error("400 context_length_exceeded")],
	])("recognises %s", (_label, err) => {
		expect(isContextOverflowError(err)).toBe(true);
	});

	it.each([
		["credits", Object.assign(new Error("402 credits depleted"), { status: 402 })],
		["rate limit", Object.assign(new Error("429 Too Many Requests"), { status: 429 })],
		["an unrelated 400", new Error("400 messages.2.assistant.reasoning_content is unsupported")],
		["a string", "maximum context length"],
	])("ignores %s", (_label, err) => {
		expect(isContextOverflowError(err)).toBe(false);
	});

	const report: AttachmentReport = {
		newest: 2,
		texts: [
			{ index: 0, name: "notes.txt", total: 20_000, shown: 5_000 },
			{ index: 2, name: "data.csv", total: 8_388_608, shown: 5_000 },
		],
		images: [
			{ index: 0, name: "a.png", sent: false },
			{ index: 2, name: "b.png", sent: true },
		],
	};

	it("names the attachments, largest first, when even the retry is refused", () => {
		const cause = Object.assign(new Error("400 maximum context length is 1048576"), {
			status: 400,
		});
		const err = new AttachmentOverflowError(report, cause);

		expect(err.message).toBe(
			"This conversation is too large for the model, even with its attachments cut down: data.csv (8,388,608 characters), notes.txt (20,000 characters), 1 image. Start a new conversation and attach a smaller part."
		);
		expect(err.status).toBe(400);
		expect(err.cause).toBe(cause);
	});

	it("retries only when the minimal request would send less", () => {
		expect(canCutAttachments(report)).toBe(false);
		expect(
			canCutAttachments({ ...report, texts: [{ index: 2, name: "x", total: 9_000, shown: 9_000 }] })
		).toBe(true);
		expect(
			canCutAttachments({ newest: 2, texts: [], images: [{ index: 0, name: "a", sent: true }] })
		).toBe(true);
		expect(canCutAttachments({ newest: 0, texts: [], images: [] })).toBe(false);
		expect(
			canCutAttachments({
				newest: 0,
				texts: [{ index: 0, name: "x", total: 5_001, shown: 5_001 }],
				images: [],
			})
		).toBe(false);
	});
});
