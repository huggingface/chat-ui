import type { Conversation } from "$lib/types/Conversation";
import { sha256 } from "./sha256";
import { rebuildLegacyContent } from "./messageShape";

export async function hashConv(conv: Conversation) {
	// messages contains the conversation message but only the immutable part
	const messages = conv.messages.map((message) => {
		// hash the legacy text so converting a message keeps its share
		const { content } = rebuildLegacyContent(message);
		return (({ from, id }) => ({ from, id, content }))(message);
	});

	const hash = await sha256(JSON.stringify(messages));
	return hash;
}
