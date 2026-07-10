import type { MessageFile } from "$lib/types/Message";
import type { EndpointMessage } from "$lib/server/endpoints/endpoints";
import type { OpenAI } from "openai";
import { TEXT_MIME_ALLOWLIST } from "$lib/constants/mime";
import { mimeMatchesAllowlist } from "$lib/utils/mime";
import {
	extractDocumentText,
	isDocumentMime,
	type DocumentExtractionResult,
} from "$lib/server/files/extractDocumentText";
import type { makeImageProcessor } from "$lib/server/endpoints/images";

/**
 * Prepare chat messages for OpenAI-compatible multimodal payloads.
 * - Processes images via the provided imageProcessor (resize/convert) when multimodal is enabled.
 * - Injects text-file content into the user message text.
 * - Extracts document (e.g. PDF) text server-side and injects it regardless of multimodality.
 * - Leaves messages untouched when no files or multimodal disabled.
 */
export async function prepareMessagesWithFiles(
	messages: EndpointMessage[],
	imageProcessor: ReturnType<typeof makeImageProcessor>,
	isMultimodal: boolean
): Promise<OpenAI.Chat.Completions.ChatCompletionMessageParam[]> {
	return Promise.all(
		messages.map(async (message) => {
			if (message.from === "user" && message.files && message.files.length > 0) {
				const { imageParts, textContent } = await prepareFiles(
					imageProcessor,
					message.files,
					isMultimodal
				);

				let messageText = message.content;
				if (textContent.length > 0) {
					messageText = textContent + "\n\n" + message.content;
				}

				if (imageParts.length > 0 && isMultimodal) {
					const parts = [{ type: "text" as const, text: messageText }, ...imageParts];
					return { role: message.from, content: parts };
				}

				return { role: message.from, content: messageText };
			}
			return { role: message.from, content: message.content };
		})
	);
}

export function formatDocumentBlock(file: MessageFile, result: DocumentExtractionResult): string {
	// Strip double quotes so the filename/mime can't break out of the "..." attributes.
	const safeName = file.name.replaceAll('"', "");
	const safeMime = file.mime.replaceAll('"', "");

	let body: string;
	switch (result.kind) {
		case "text": {
			body = result.text;
			if (result.truncated) {
				const shown = result.text.length;
				body +=
					shown < result.totalChars
						? `\n\n[Document truncated: showing the first ${shown.toLocaleString(
								"en-US"
							)} of ${result.totalChars.toLocaleString("en-US")} characters]`
						: "\n\n[Document truncated: only part of the document could be read]";
			}
			break;
		}
		case "empty":
			body =
				"[This document contains no extractable text. It may be a scanned document or contain only images; tell the user you cannot read its contents.]";
			break;
		case "error":
			body = `[Could not extract text from this document: ${result.reason}. Tell the user the file could not be read.]`;
			break;
	}

	return `<document name="${safeName}" type="${safeMime}">\n${body}\n</document>`;
}

async function prepareFiles(
	imageProcessor: ReturnType<typeof makeImageProcessor>,
	files: MessageFile[],
	isMultimodal: boolean
): Promise<{
	imageParts: OpenAI.Chat.Completions.ChatCompletionContentPartImage[];
	textContent: string;
}> {
	const imageFiles = files.filter((file) => file.mime.startsWith("image/"));
	const documentFiles = files.filter((file) => isDocumentMime(file.mime));
	const textFiles = files.filter(
		(file) => !isDocumentMime(file.mime) && mimeMatchesAllowlist(file.mime, TEXT_MIME_ALLOWLIST)
	);

	let imageParts: OpenAI.Chat.Completions.ChatCompletionContentPartImage[] = [];
	if (isMultimodal && imageFiles.length > 0) {
		const processedFiles = await Promise.all(imageFiles.map(imageProcessor));
		imageParts = processedFiles.map((file) => ({
			type: "image_url" as const,
			image_url: {
				url: `data:${file.mime};base64,${file.image.toString("base64")}`,
				detail: "auto",
			},
		}));
	}

	// Documents are extracted server-side and injected as text, so they work for any model.
	const documentParts = await Promise.all(
		documentFiles.map(async (file) => {
			try {
				const data = new Uint8Array(Buffer.from(file.value, "base64"));
				const result = await extractDocumentText(data, file.mime);
				return formatDocumentBlock(file, result);
			} catch {
				// extractDocumentText never throws, but extraction must never kill generation.
				return formatDocumentBlock(file, {
					kind: "error",
					reason: "unreadable or corrupted",
				});
			}
		})
	);

	const textParts = await Promise.all(
		textFiles.map(async (file) => {
			const content = Buffer.from(file.value, "base64").toString("utf-8");
			return `<document name="${file.name}" type="${file.mime}">\n${content}\n</document>`;
		})
	);

	const textContent = [...documentParts, ...textParts].join("\n\n");

	return { imageParts, textContent };
}
