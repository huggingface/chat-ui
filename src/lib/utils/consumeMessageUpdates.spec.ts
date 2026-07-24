import { describe, expect, it, vi } from "vitest";
import type { Message } from "$lib/types/Message";
import {
	MessageUpdateType,
	type MessageStreamUpdate,
	type MessageUpdate,
} from "$lib/types/MessageUpdate";
import { consumeMessageUpdates, type ConsumeContext } from "./consumeMessageUpdates";

async function* fromArray(values: MessageUpdate[]): AsyncGenerator<MessageUpdate> {
	for (const value of values) yield value;
}

function context(): ConsumeContext {
	return {
		streamingMode: "raw",
		maxUpdateTime: Number.POSITIVE_INFINITY,
		isAborted: () => false,
		onAbort: vi.fn(),
		onStreamStart: vi.fn(),
		onTitle: vi.fn(),
		onError: vi.fn(),
	};
}

function renderedText(message: Message): string {
	let cursor = 0;
	let rendered = "";
	for (const update of message.updates ?? []) {
		if (update.type !== MessageUpdateType.Stream) continue;
		const token = update.token.length > 0 ? update.token : null;
		const len = token?.length ?? update.len ?? 0;
		rendered += token ?? message.content.slice(cursor, cursor + len);
		cursor += len;
	}
	return rendered + message.content.slice(cursor);
}

describe("consumeMessageUpdates", () => {
	it("preserves a compressed stream marker when reattach appends live text", async () => {
		const prefix = "north of Greenland";
		const boundary = "'s";
		const continuation = " fractured coast";
		const message: Message = {
			id: "00000000-0000-4000-8000-000000000000",
			from: "assistant",
			content: prefix + boundary,
			updates: [
				{ type: MessageUpdateType.Stream, token: "", len: prefix.length },
				{ type: MessageUpdateType.Stream, token: "", len: boundary.length },
			],
		};

		await consumeMessageUpdates(
			fromArray([{ type: MessageUpdateType.Stream, token: continuation }]),
			message,
			context()
		);

		expect(message.content).toBe(prefix + boundary + continuation);
		expect(message.updates?.at(-1)).toEqual({
			type: MessageUpdateType.Stream,
			token: "",
			len: boundary.length + continuation.length,
		});
		expect(renderedText(message)).toBe(message.content);
	});

	it("continues merging ordinary live stream tokens", async () => {
		const message: Message = {
			id: "00000000-0000-4000-8000-000000000000",
			from: "assistant",
			content: "hello ",
			updates: [{ type: MessageUpdateType.Stream, token: "hello " }],
		};

		await consumeMessageUpdates(
			fromArray([{ type: MessageUpdateType.Stream, token: "world" }]),
			message,
			context()
		);

		expect(message.updates?.at(-1)).toEqual({
			type: MessageUpdateType.Stream,
			token: "hello world",
		} satisfies MessageStreamUpdate);
		expect(renderedText(message)).toBe("hello world");
	});
});
