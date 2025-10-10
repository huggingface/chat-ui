import { processTokens, type Token } from "$lib/utils/marked";

export type IncomingMessage = {
	type: "process";
	content: string;
};

export type OutgoingMessage = {
	type: "processed";
	tokens: Token[];
};

// Flag to track if the worker is currently processing a message
let isProcessing = false;

// Buffer to store the latest incoming message
let latestMessage: IncomingMessage | null = null;

// Helper function to safely handle the latest message
async function processMessage() {
	if (latestMessage) {
		const nextMessage = latestMessage;

		latestMessage = null;
		isProcessing = true;

		try {
			const { content } = nextMessage;
			const processedTokens = await processTokens(content);
			postMessage(JSON.parse(JSON.stringify({ type: "processed", tokens: processedTokens })));
		} finally {
			isProcessing = false;

			// After processing, check if a new message was buffered
			await new Promise((resolve) => setTimeout(resolve, 100));
			processMessage();
		}
	}
}

onmessage = (event) => {
	if (event.data.type !== "process") {
		return;
	}

	latestMessage = event.data as IncomingMessage;

	if (!isProcessing && latestMessage) {
		processMessage();
	}
};
