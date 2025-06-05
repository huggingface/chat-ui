import type { MessageFile } from "$lib/types/Message";
import {
	type MessageUpdate,
	type MessageStreamUpdate,
	type MessageToolCallUpdate,
	MessageToolUpdateType,
	MessageUpdateType,
	type MessageToolUpdate,
	type MessageWebSearchUpdate,
	type MessageWebSearchGeneralUpdate,
	type MessageWebSearchSourcesUpdate,
	type MessageWebSearchErrorUpdate,
	MessageWebSearchUpdateType,
	type MessageToolErrorUpdate,
	type MessageToolResultUpdate,
} from "$lib/types/MessageUpdate";

import { page } from "$app/state";

export const isMessageWebSearchUpdate = (update: MessageUpdate): update is MessageWebSearchUpdate =>
	update.type === MessageUpdateType.WebSearch;
export const isMessageWebSearchGeneralUpdate = (
	update: MessageUpdate
): update is MessageWebSearchGeneralUpdate =>
	isMessageWebSearchUpdate(update) && update.subtype === MessageWebSearchUpdateType.Update;
export const isMessageWebSearchSourcesUpdate = (
	update: MessageUpdate
): update is MessageWebSearchSourcesUpdate =>
	isMessageWebSearchUpdate(update) && update.subtype === MessageWebSearchUpdateType.Sources;
export const isMessageWebSearchErrorUpdate = (
	update: MessageUpdate
): update is MessageWebSearchErrorUpdate =>
	isMessageWebSearchUpdate(update) && update.subtype === MessageWebSearchUpdateType.Error;

export const isMessageToolUpdate = (update: MessageUpdate): update is MessageToolUpdate =>
	update.type === MessageUpdateType.Tool;
export const isMessageToolCallUpdate = (update: MessageUpdate): update is MessageToolCallUpdate =>
	isMessageToolUpdate(update) && update.subtype === MessageToolUpdateType.Call;
export const isMessageToolResultUpdate = (
	update: MessageUpdate
): update is MessageToolResultUpdate =>
	isMessageToolUpdate(update) && update.subtype === MessageToolUpdateType.Result;
export const isMessageToolErrorUpdate = (update: MessageUpdate): update is MessageToolErrorUpdate =>
	isMessageToolUpdate(update) && update.subtype === MessageToolUpdateType.Error;

type MessageUpdateRequestOptions = {
	base: string;
	inputs?: string;
	messageId?: string;
	isRetry: boolean;
	isContinue: boolean;
	webSearch: boolean;
	tools?: Array<string>;
	files?: MessageFile[];
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
		is_continue: opts.isContinue,
		web_search: opts.webSearch,
		tools: opts.tools,
	});

	opts.files?.forEach((file) => {
		const name = file.type + ";" + file.name;

		form.append("files", new File([file.value], name, { type: file.mime }));
	});

	form.append("data", optsJSON);

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

	if (!(page.data.publicConfig.PUBLIC_SMOOTH_UPDATES === "true")) {
		return endpointStreamToIterator(response, abortController);
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
	let bufferedStreamUpdates: MessageStreamUpdate[] = [];

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
				type: MessageUpdateType.Stream,
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
