import { makeImageProcessor, type ImageProcessorOptions } from "../images";
import { makeDocumentProcessor, type FileProcessorOptions } from "../document";
import type { EndpointMessage } from "../endpoints";
import type { MessageFile } from "$lib/types/Message";
import type {
	ImageBlockParam,
	MessageParam,
	TextBlockParam,
} from "@anthropic-ai/sdk/resources/messages.mjs";

export interface DocumentBlockParam {
	type: "document";
	source: {
		data: string;
		media_type: "application/pdf";
		type: "base64";
	};
}

export type ExtendedContentBlock = ImageBlockParam | TextBlockParam | DocumentBlockParam;

export interface ExtendedMessageParam extends Omit<MessageParam, "content"> {
	content: ExtendedContentBlock[];
}

export async function fileToImageBlock(
	file: MessageFile,
	opts: ImageProcessorOptions<"image/png" | "image/jpeg" | "image/webp">
): Promise<ImageBlockParam> {
	const processor = makeImageProcessor(opts);
	const { image, mime } = await processor(file);

	return {
		type: "image",
		source: {
			type: "base64",
			media_type: mime,
			data: image.toString("base64"),
		},
	};
}

export async function fileToDocumentBlock(
	file: MessageFile,
	opts: FileProcessorOptions<"application/pdf">
): Promise<DocumentBlockParam> {
	const processor = makeDocumentProcessor(opts);
	const { file: document, mime } = processor(file);

	return {
		type: "document",
		source: {
			type: "base64",
			media_type: mime,
			data: document.toString("base64"),
		},
	};
}

type NonSystemMessage = EndpointMessage & { from: "user" | "assistant" };
export async function endpointMessagesToAnthropicMessages(
	messages: EndpointMessage[],
	multimodal: {
		image: ImageProcessorOptions<"image/png" | "image/jpeg" | "image/webp">;
		document?: FileProcessorOptions<"application/pdf">; // Make optional
	}
): Promise<ExtendedMessageParam[]> {
	return await Promise.all(
		messages
			.filter((message): message is NonSystemMessage => message.from !== "system")
			.map<Promise<ExtendedMessageParam>>(async (message) => {
				return {
					role: message.from,
					content: [
						...(await Promise.all(
							(message.files ?? []).map(async (file) => {
								if (file.mime.startsWith("image/")) {
									return fileToImageBlock(file, multimodal.image);
								} else if (file.mime === "application/pdf" && multimodal.document) {
									return fileToDocumentBlock(file, multimodal.document);
								} else {
									throw new Error(`Unsupported file type: ${file.mime}`);
								}
							})
						)),
						{ type: "text", text: message.content },
					],
				};
			})
	);
}
