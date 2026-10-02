import type { Message } from "$lib/types/Message";
import type { EndpointMessage } from "./endpoints";
import { downloadFile } from "../files/downloadFile";
import type { ObjectId } from "mongodb";
import { withTrackioViewContext } from "$lib/utils/trackioView";

export async function preprocessMessages(
	messages: Message[],
	convId: ObjectId
): Promise<EndpointMessage[]> {
	return Promise.resolve(messages)
		.then((msgs) => downloadFiles(msgs, convId))
		.then(injectTrackioViews)
		.then(stripEmptyInitialSystemMessage);
}

/** pasted text stays a file, the prompt builder inlines it within the attachment budget */
async function downloadFiles(messages: Message[], convId: ObjectId): Promise<EndpointMessage[]> {
	return Promise.all(
		messages.map<Promise<EndpointMessage>>((message) =>
			Promise.all(
				(message.files ?? []).map(async (file) => {
					const downloaded = await downloadFile(file.value, convId);
					// the bucket names a file by conversation id and hash, the message keeps the uploaded name
					return { ...downloaded, name: file.name || downloaded.name };
				})
			).then((files) => ({ ...message, files }))
		)
	);
}

/** A user message's attached dashboard views become text the model reads with it. */
function injectTrackioViews(messages: EndpointMessage[]): EndpointMessage[] {
	return messages.map((message) =>
		message.from === "user" && message.dashboardViews?.length
			? { ...message, content: withTrackioViewContext(message.content, message.dashboardViews) }
			: message
	);
}

/**
 * Remove an initial system message if its content is empty/whitespace only.
 * This prevents sending an empty system prompt to any provider.
 */
function stripEmptyInitialSystemMessage(messages: EndpointMessage[]): EndpointMessage[] {
	if (!messages?.length) return messages;
	const first = messages[0];
	if (first?.from !== "system") return messages;

	const content = first?.content as unknown;
	const isEmpty = typeof content === "string" ? content.trim().length === 0 : false;

	if (isEmpty) {
		return messages.slice(1);
	}

	return messages;
}
