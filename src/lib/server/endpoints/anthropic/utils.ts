import type { ImageBlockParam, MessageParam } from "@anthropic-ai/sdk/resources";
import { makeImageProcessor, type ImageProcessorOptions } from "../images";
import type { EndpointMessage } from "../endpoints";
import type { MessageFile } from "$lib/types/Message";

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

type NonSystemMessage = EndpointMessage & { from: "user" | "assistant" };

export async function endpointMessagesToAnthropicMessages(
	messages: EndpointMessage[],
	multimodal: { image: ImageProcessorOptions<"image/png" | "image/jpeg" | "image/webp"> }
): Promise<MessageParam[]> {
	return await Promise.all(
		messages
			.filter((message): message is NonSystemMessage => message.from !== "system")
			.map<Promise<MessageParam>>(async (message) => {
				return {
					role: message.from,
					content: [
						...(await Promise.all(
							(message.files ?? []).map((file) => fileToImageBlock(file, multimodal.image))
						)),
						{ type: "text", text: message.content },
					],
				};
			})
	);
}
