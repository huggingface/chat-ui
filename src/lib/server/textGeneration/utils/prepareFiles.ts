import type { MessageFile } from "$lib/types/Message";
import type { EndpointMessage } from "$lib/server/endpoints/endpoints";
import type { OpenAI } from "openai";
import { TEXT_MIME_ALLOWLIST } from "$lib/constants/mime";
import type { makeImageProcessor } from "$lib/server/endpoints/images";

/** MIME types that OpenAI handles natively as file content parts */
const NATIVE_FILE_MIMETYPES = ["application/pdf"] as const;

function matchesMimeAllowlist(mime: string, allowlist: readonly string[]): boolean {
	const normalizedMime = (mime || "").toLowerCase();
	const [fileType, fileSubtype] = normalizedMime.split("/");
	return allowlist.some((allowed) => {
		const [type, subtype] = allowed.toLowerCase().split("/");
		const typeOk = type === "*" || type === fileType;
		const subOk = subtype === "*" || subtype === fileSubtype;
		return typeOk && subOk;
	});
}

/**
 * Prepare chat messages for OpenAI-compatible multimodal payloads.
 * - Processes images via the provided imageProcessor (resize/convert) when multimodal is enabled.
 * - Sends PDFs as native file content parts when the model accepts them.
 * - Injects text-file content into the user message text.
 * - Leaves messages untouched when no files or multimodal disabled.
 */
export async function prepareMessagesWithFiles(
	messages: EndpointMessage[],
	imageProcessor: ReturnType<typeof makeImageProcessor>,
	isMultimodal: boolean,
	acceptedFileMimetypes?: string[]
): Promise<OpenAI.Chat.Completions.ChatCompletionMessageParam[]> {
	return Promise.all(
		messages.map(async (message) => {
			if (message.from === "user" && message.files && message.files.length > 0) {
				const { imageParts, fileParts, textContent } = await prepareFiles(
					imageProcessor,
					message.files,
					isMultimodal,
					acceptedFileMimetypes
				);

				let messageText = message.content;
				if (textContent.length > 0) {
					messageText = textContent + "\n\n" + message.content;
				}

				const multimodalParts = [...imageParts, ...fileParts];
				if (multimodalParts.length > 0) {
					const parts = [{ type: "text" as const, text: messageText }, ...multimodalParts];
					return { role: message.from, content: parts };
				}

				return { role: message.from, content: messageText };
			}
			return { role: message.from, content: message.content };
		})
	);
}

async function prepareFiles(
	imageProcessor: ReturnType<typeof makeImageProcessor>,
	files: MessageFile[],
	isMultimodal: boolean,
	acceptedFileMimetypes?: string[]
): Promise<{
	imageParts: OpenAI.Chat.Completions.ChatCompletionContentPartImage[];
	fileParts: OpenAI.Chat.Completions.ChatCompletionContentPart.File[];
	textContent: string;
}> {
	const imageFiles = files.filter((file) => file.mime.startsWith("image/"));
	const textFiles = files.filter((file) => matchesMimeAllowlist(file.mime, TEXT_MIME_ALLOWLIST));

	// Files that the model accepts natively (e.g. PDFs via OpenAI's file content part)
	const nativeFiles = files.filter(
		(file) =>
			!file.mime.startsWith("image/") &&
			!matchesMimeAllowlist(file.mime, TEXT_MIME_ALLOWLIST) &&
			acceptedFileMimetypes &&
			matchesMimeAllowlist(file.mime, acceptedFileMimetypes) &&
			matchesMimeAllowlist(file.mime, NATIVE_FILE_MIMETYPES)
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

	// Send natively-supported files as OpenAI file content parts
	const fileParts: OpenAI.Chat.Completions.ChatCompletionContentPart.File[] = nativeFiles.map(
		(file) => ({
			type: "file" as const,
			file: {
				filename: file.name,
				file_data: `data:${file.mime};base64,${file.value}`,
			},
		})
	);

	let textContent = "";
	if (textFiles.length > 0) {
		const textParts = await Promise.all(
			textFiles.map(async (file) => {
				const content = Buffer.from(file.value, "base64").toString("utf-8");
				return `<document name="${file.name}" type="${file.mime}">\n${content}\n</document>`;
			})
		);
		textContent = textParts.join("\n\n");
	}

	return { imageParts, fileParts, textContent };
}
