import { makeImageProcessor, type ImageProcessorOptions } from "../images";
import { makeDocumentProcessor, type FileProcessorOptions } from "../document";
import type { EndpointMessage } from "../endpoints";
import type { MessageFile } from "$lib/types/Message";
import type {
	BetaImageBlockParam,
	BetaMessageParam,
	BetaBase64PDFBlock,
} from "@anthropic-ai/sdk/resources/beta/messages/messages.mjs";
import type { ToolResult } from "$lib/types/Tool";
import { downloadFile } from "$lib/server/files/downloadFile";
import type { ObjectId } from "mongodb";

export async function fileToImageBlock(
	file: MessageFile,
	opts: ImageProcessorOptions<"image/png" | "image/jpeg" | "image/webp">
): Promise<BetaImageBlockParam> {
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
): Promise<BetaBase64PDFBlock> {
	const processor = makeDocumentProcessor(opts);
	const { file: document, mime } = await processor(file);

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
		document?: FileProcessorOptions<"application/pdf">;
	},
	conversationId?: ObjectId | undefined
): Promise<BetaMessageParam[]> {
	return await Promise.all(
		messages
			.filter((message): message is NonSystemMessage => message.from !== "system")
			.map<Promise<BetaMessageParam>>(async (message) => {
				return {
					role: message.from,
					content: [
						...(message.from === "user"
							? await Promise.all(
									(message.files ?? []).map(async (file) => {
										if (file.type === "hash" && conversationId) {
											file = await downloadFile(file.value, conversationId);
										}

										if (file.mime.startsWith("image/")) {
											return fileToImageBlock(file, multimodal.image);
										} else if (file.mime === "application/pdf" && multimodal.document) {
											return fileToDocumentBlock(file, multimodal.document);
										} else {
											throw new Error(`Unsupported file type: ${file.mime}`);
										}
									})
							  )
							: []),
						{ type: "text", text: message.content },
					],
				};
			})
	);
}

export function addToolResults(
	messages: BetaMessageParam[],
	toolResults: ToolResult[]
): BetaMessageParam[] {
	const id = crypto.randomUUID();
	if (toolResults.length === 0) {
		return messages;
	}
	return [
		...messages,
		{
			role: "assistant",
			content: toolResults.map((result, index) => ({
				type: "tool_use",
				id: `tool_${index}_${id}`,
				name: result.call.name,
				input: result.call.parameters,
			})),
		},
		{
			role: "user",
			content: toolResults.map((result, index) => ({
				type: "tool_result",
				tool_use_id: `tool_${index}_${id}`,
				is_error: result.status === "error",
				content: JSON.stringify(
					result.status === "error" ? result.message : "outputs" in result ? result.outputs : ""
				),
			})),
		},
	];
}
