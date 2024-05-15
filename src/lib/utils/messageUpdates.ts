import type { MessageUpdate, TextStreamUpdate } from "$lib/types/MessageUpdate";

type MessageUpdateRequestOptions = {
	base: string;
	inputs?: string;
	messageId?: string;
	isRetry: boolean;
	isContinue: boolean;
	webSearch: boolean;
	files?: string[];
};
export async function fetchMessageUpdates(
	conversationId: string,
	opts: MessageUpdateRequestOptions,
	abortSignal: AbortSignal
): Promise<AsyncGenerator<MessageUpdate>> {
	const abortController = new AbortController();
	abortSignal.addEventListener("abort", () => abortController.abort());

	const response = await fetch(`${opts.base}/conversation/${conversationId}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			inputs: opts.inputs,
			id: opts.messageId,
			is_retry: opts.isRetry,
			is_continue: opts.isContinue,
			web_search: opts.webSearch,
			files: opts.files,
		}),
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
	return smoothAsyncIterator(
		streamMessageUpdatesToFullWords(endpointStreamToIterator(response, abortController))
	);
}

async function* endpointStreamToIterator(
	response: Response,
	abortController: AbortController
): AsyncGenerator<MessageUpdate> {
	const reader = response.body?.pipeThrough(new TextDecoderStream()).getReader();
	if (!reader) throw Error("Response for endpoint had no body");

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
		if (!value) continue;

		const { messageUpdates, remainingText } = parseMessageUpdates(prevChunk + value);
		prevChunk = remainingText;
		for (const messageUpdate of messageUpdates) yield messageUpdate;
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

/**
 * Emits all the message updates immediately that aren't "stream" type
 * Emits a concatenated "stream" type message update once it detects a full word
 * Example: "what" " don" "'t" => "what" " don't"
 * Only supports latin languages, ignores others
 */
async function* streamMessageUpdatesToFullWords(
	iterator: AsyncGenerator<MessageUpdate>
): AsyncGenerator<MessageUpdate> {
	let bufferedStreamUpdates: TextStreamUpdate[] = [];

	const endAlphanumeric = /[a-zA-Z0-9À-ž'`]+$/;
	const beginnningAlphanumeric = /^[a-zA-Z0-9À-ž'`]+/;

	for await (const messageUpdate of iterator) {
		if (messageUpdate.type !== "stream") {
			yield messageUpdate;
			continue;
		}
		bufferedStreamUpdates.push(messageUpdate);

		let lastIndexEmitted = 0;
		for (let i = 1; i < bufferedStreamUpdates.length; i++) {
			const prevEndsAlphanumeric = endAlphanumeric.test(bufferedStreamUpdates[i - 1].token);
			const currBeginsAlphanumeric = beginnningAlphanumeric.test(bufferedStreamUpdates[i].token);
			const shouldCombine = prevEndsAlphanumeric && currBeginsAlphanumeric;
			const combinedTooMany = i - lastIndexEmitted >= 5;
			if (shouldCombine && !combinedTooMany) continue;

			// Combine tokens together and emit
			yield {
				type: "stream",
				token: bufferedStreamUpdates
					.slice(lastIndexEmitted, i)
					.map((_) => _.token)
					.join(""),
			};
			lastIndexEmitted = i;
		}
		bufferedStreamUpdates = bufferedStreamUpdates.slice(lastIndexEmitted);
	}
	for (const messageUpdate of bufferedStreamUpdates) yield messageUpdate;
}

/**
 * Attempts to smooth out the time between values emitted by an async iterator
 * by waiting for the average time between values to emit the next value
 */
async function* smoothAsyncIterator<T>(iterator: AsyncGenerator<T>): AsyncGenerator<T> {
	const eventTarget = new EventTarget();
	let done = false;
	const valuesBuffer: T[] = [];
	const valueTimesMS: number[] = [];

	const next = async () => {
		const obj = await iterator.next();
		if (obj.done) {
			done = true;
		} else {
			valuesBuffer.push(obj.value);
			valueTimesMS.push(performance.now());
			next();
		}
		eventTarget.dispatchEvent(new Event("next"));
	};
	next();

	let timeOfLastEmitMS = performance.now();
	while (!done || valuesBuffer.length > 0) {
		// Only consider the last X times between tokens
		const sampledTimesMS = valueTimesMS.slice(-30);

		// Get the total time spent in abnormal periods
		const anomalyThresholdMS = 2000;
		const anomalyDurationMS = sampledTimesMS
			.map((time, i, times) => time - times[i - 1])
			.slice(1)
			.filter((time) => time > anomalyThresholdMS)
			.reduce((a, b) => a + b, 0);

		// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
		const totalTimeMSBetweenValues = sampledTimesMS.at(-1)! - sampledTimesMS[0];
		const timeMSBetweenValues = totalTimeMSBetweenValues - anomalyDurationMS;

		const averageTimeMSBetweenValues = Math.min(
			200,
			timeMSBetweenValues / (sampledTimesMS.length - 1)
		);
		const timeSinceLastEmitMS = performance.now() - timeOfLastEmitMS;

		// Emit after waiting duration or cancel if "next" event is emitted
		const gotNext = await Promise.race([
			sleep(Math.max(5, averageTimeMSBetweenValues - timeSinceLastEmitMS)),
			waitForEvent(eventTarget, "next"),
		]);

		// Go to next iteration so we can re-calculate when to emit
		if (gotNext) continue;

		// Nothing in buffer to emit
		if (valuesBuffer.length === 0) continue;

		// Emit
		timeOfLastEmitMS = performance.now();
		// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
		yield valuesBuffer.shift()!;
	}
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const waitForEvent = (eventTarget: EventTarget, eventName: string) =>
	new Promise<boolean>((resolve) =>
		eventTarget.addEventListener(eventName, () => resolve(true), { once: true })
	);
