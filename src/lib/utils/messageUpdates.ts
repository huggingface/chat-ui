import type { MessageFile } from "$lib/types/Message";
import type { MessageUpdate } from "$lib/types/MessageUpdate";

import type { Conversation } from "$lib/types/Conversation";

type MessageUpdateRequestOptions = {
	base: string;
	inputs?: string;
	messageId?: string;
	isRetry: boolean;
	files?: MessageFile[];
	conversation?: Conversation;
	globalSettings?: {
		securityApiEnabled?: boolean;
		securityApiUrl?: string;
		securityApiKey?: string;
		llmApiUrl?: string;
		llmApiKey?: string;
	};
};
export async function fetchMessageUpdates(
	conversationId: string,
	opts: MessageUpdateRequestOptions,
	abortSignal: AbortSignal
): Promise<AsyncGenerator<MessageUpdate>> {
	const abortController = new AbortController();
	abortSignal.addEventListener("abort", () => abortController.abort());

	const form = new FormData();

	const optsJSON = JSON.stringify({
		inputs: opts.inputs,
		id: opts.messageId,
		is_retry: opts.isRetry,
	});

	opts.files?.forEach((file) => {
		const name = file.type + ";" + file.name;

		form.append("files", new File([file.value], name, { type: file.mime }));
	});

	form.append("data", optsJSON);

	// Add conversation data for server-side processing
	if (opts.conversation) {
		form.append("conversation", JSON.stringify(opts.conversation));
	}

	// Add global settings for server-side processing
	if (opts.globalSettings) {
		form.append("globalSettings", JSON.stringify(opts.globalSettings));
	}

	const response = await fetch(`${opts.base}/conversation/${conversationId}`, {
		method: "POST",
		body: form,
		signal: abortController.signal,
	});

	if (!response.ok) {
		const errorMessage = await response
			.json()
			.then((obj) => obj.message)
			.catch(() => `Request failed with status code ${response.status}: ${response.statusText}`);
		throw Error(errorMessage);
	}
	if (!response.body) {
		throw Error("Body not defined");
	}

	return endpointStreamToIterator(response, abortController);
}

async function* endpointStreamToIterator(
	response: Response,
	abortController: AbortController
): AsyncGenerator<MessageUpdate> {
	const reader = response.body?.pipeThrough(new TextDecoderStream()).getReader();
	if (!reader) {
		throw Error("Response for endpoint had no body");
	}

	// Handle any cases where we must abort
	reader.closed.then(() => abortController.abort());

	// Handle logic for aborting
	abortController.signal.addEventListener("abort", () => reader.cancel());

	// ex) If the last response is => {"type": "stream", "token":
	// It should be => {"type": "stream", "token": "Hello"} = prev_input_chunk + "Hello"}
	let prevChunk = "";
	while (!abortController.signal.aborted) {
		const { done, value } = await reader.read();
		if (done) {
			abortController.abort();
			break;
		}
		if (!value) {
			continue;
		}

		const { messageUpdates, remainingText } = parseMessageUpdates(prevChunk + value);
		prevChunk = remainingText;
		for (const messageUpdate of messageUpdates) {
			yield messageUpdate;
		}
	}
}

function parseMessageUpdates(value: string): {
	messageUpdates: MessageUpdate[];
	remainingText: string;
} {
	const inputs = value.split("\n");
	const messageUpdates: MessageUpdate[] = [];
	for (const input of inputs) {
		try {
			messageUpdates.push(JSON.parse(input) as MessageUpdate);
		} catch (error) {
			// in case of parsing error, we return what we were able to parse
			if (error instanceof SyntaxError) {
				return {
					messageUpdates,
					remainingText: inputs.at(-1) ?? "",
				};
			}
		}
	}
	return { messageUpdates, remainingText: "" };
}
