import { base } from "$app/paths";

export async function createConversation(body?: { fromShare: string }) {
	const res = await fetch(`${base}/conversation`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
	});

	const { conversationId } = await res.json();

	return conversationId;
}
