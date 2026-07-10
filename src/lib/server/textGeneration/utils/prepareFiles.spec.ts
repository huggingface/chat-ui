import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import type { EndpointMessage } from "$lib/server/endpoints/endpoints";
import type { MessageFile } from "$lib/types/Message";
import { formatDocumentBlock, prepareMessagesWithFiles } from "./prepareFiles";

const FIXTURE_TEXT = "Hello chat-ui PDF fixture";
const PROMPT = "Please summarize the attached file.";

async function loadFixtureBase64(name: string): Promise<string> {
	const data = await readFile(new URL(`../../files/__tests__/fixtures/${name}`, import.meta.url));
	return data.toString("base64");
}

function pdfFile(value: string, name = "doc.pdf"): MessageFile {
	return { type: "base64", name, value, mime: "application/pdf" };
}

function userMessage(files: MessageFile[]): EndpointMessage {
	return { from: "user", content: PROMPT, files };
}

function makeStubImageProcessor() {
	return vi.fn(async () => ({ image: Buffer.from("fake-image-bytes"), mime: "image/jpeg" }));
}

describe("prepareMessagesWithFiles", () => {
	it("injects PDF text as a string message when not multimodal", async () => {
		const imageProcessor = makeStubImageProcessor();
		const value = await loadFixtureBase64("sample.pdf");

		const [message] = await prepareMessagesWithFiles(
			[userMessage([pdfFile(value)])],
			imageProcessor,
			false
		);

		expect(typeof message.content).toBe("string");
		const content = message.content as string;
		expect(content).toContain('<document name="doc.pdf" type="application/pdf">');
		expect(content).toContain(FIXTURE_TEXT);
		// The document block comes first, followed by the original prompt.
		expect(content.indexOf("</document>")).toBeLessThan(content.indexOf(PROMPT));
		expect(content.endsWith(PROMPT)).toBe(true);
		expect(imageProcessor).not.toHaveBeenCalled();
	});

	it("combines a PDF document block with image parts when multimodal", async () => {
		const imageProcessor = makeStubImageProcessor();
		const value = await loadFixtureBase64("sample.pdf");
		const imageFile: MessageFile = {
			type: "base64",
			name: "photo.png",
			value: Buffer.from("not-a-real-png").toString("base64"),
			mime: "image/png",
		};

		const [message] = await prepareMessagesWithFiles(
			[userMessage([pdfFile(value), imageFile])],
			imageProcessor,
			true
		);

		expect(Array.isArray(message.content)).toBe(true);
		const parts = message.content as { type: string; text?: string }[];
		const textParts = parts.filter((part) => part.type === "text");
		const imageParts = parts.filter((part) => part.type === "image_url");
		expect(textParts).toHaveLength(1);
		expect(textParts[0].text).toContain('<document name="doc.pdf" type="application/pdf">');
		expect(textParts[0].text).toContain(FIXTURE_TEXT);
		expect(imageParts).toHaveLength(1);
		expect(imageProcessor).toHaveBeenCalledTimes(1);
	});

	it("produces an error note for a corrupt PDF without failing", async () => {
		const imageProcessor = makeStubImageProcessor();
		const value = await loadFixtureBase64("corrupt.pdf");

		const [message] = await prepareMessagesWithFiles(
			[userMessage([pdfFile(value, "broken.pdf")])],
			imageProcessor,
			false
		);

		const content = message.content as string;
		expect(content).toContain('<document name="broken.pdf" type="application/pdf">');
		expect(content).toContain("[Could not extract text");
	});

	it("notes when a PDF has no extractable text", async () => {
		const imageProcessor = makeStubImageProcessor();
		const value = await loadFixtureBase64("empty-text.pdf");

		const [message] = await prepareMessagesWithFiles(
			[userMessage([pdfFile(value, "scan.pdf")])],
			imageProcessor,
			false
		);

		const content = message.content as string;
		expect(content).toContain("[This document contains no extractable text.");
	});

	it("still injects plain text files", async () => {
		const imageProcessor = makeStubImageProcessor();
		const textFile: MessageFile = {
			type: "base64",
			name: "notes.txt",
			value: Buffer.from("some plain notes").toString("base64"),
			mime: "text/plain",
		};

		const [message] = await prepareMessagesWithFiles(
			[userMessage([textFile])],
			imageProcessor,
			false
		);

		const content = message.content as string;
		expect(content).toContain('<document name="notes.txt" type="text/plain">');
		expect(content).toContain("some plain notes");
	});

	it("ignores files on non-user messages", async () => {
		const imageProcessor = makeStubImageProcessor();
		const value = await loadFixtureBase64("sample.pdf");
		const assistantMessage: EndpointMessage = {
			from: "assistant",
			content: "Here is my answer.",
			files: [pdfFile(value)],
		};

		const [message] = await prepareMessagesWithFiles([assistantMessage], imageProcessor, false);

		expect(message.content).toBe("Here is my answer.");
		expect(imageProcessor).not.toHaveBeenCalled();
	});

	it("silently drops unsupported files", async () => {
		const imageProcessor = makeStubImageProcessor();
		const zipFile: MessageFile = {
			type: "base64",
			name: "archive.zip",
			value: Buffer.from("zip-bytes").toString("base64"),
			mime: "application/zip",
		};

		const [message] = await prepareMessagesWithFiles(
			[userMessage([zipFile])],
			imageProcessor,
			false
		);

		expect(message.content).toBe(PROMPT);
	});
});

describe("formatDocumentBlock", () => {
	it("renders a truncation marker with formatted counts", () => {
		const block = formatDocumentBlock(pdfFile("", "doc.pdf"), {
			kind: "text",
			text: "abcde",
			truncated: true,
			totalChars: 12345,
		});

		expect(block).toContain("abcde");
		expect(block).toContain("[Document truncated: showing the first 5 of 12,345 characters]");
	});

	it("strips double quotes from the file name", () => {
		const block = formatDocumentBlock(pdfFile("", 'my "quoted" doc.pdf'), {
			kind: "text",
			text: "body",
			truncated: false,
			totalChars: 4,
		});

		expect(block).toContain('<document name="my quoted doc.pdf" type="application/pdf">');
	});
});
