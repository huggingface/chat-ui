import { describe, expect, it } from "vitest";
import type { Message } from "$lib/types/Message";
import {
	MessageToolUpdateType,
	MessageUpdateStatus,
	MessageUpdateType,
} from "$lib/types/MessageUpdate";
import { mergeFinalAnswer } from "./mergeFinalAnswer";
import { processClientUpdate } from "./processClientUpdate";

function createMessage(overrides?: Partial<Message>): Message {
	return {
		id: "assistant-1",
		from: "assistant",
		content: "",
		updates: [],
		...overrides,
	};
}

describe("processClientUpdate", () => {
	it("buffers stream updates and flushes them on non-stream updates", () => {
		const initial = createMessage();

		const firstStream = processClientUpdate({
			message: initial,
			update: { type: MessageUpdateType.Stream, token: "Hel\0" },
			disableStream: false,
			buffer: "",
			lastUpdateTime: new Date("2026-01-01T00:00:00.000Z"),
			maxUpdateTimeMs: 100,
			now: new Date("2026-01-01T00:00:00.010Z"),
		});

		expect(firstStream.message.updates?.at(-1)).toEqual({
			type: MessageUpdateType.Stream,
			token: "Hel",
		});
		expect(firstStream.buffer).toBe("Hel");
		expect(firstStream.message.content).toBe("");
		expect(firstStream.effects.setPendingFalse).toBe(true);

		const secondStream = processClientUpdate({
			message: firstStream.message,
			update: { type: MessageUpdateType.Stream, token: "lo" },
			disableStream: false,
			buffer: firstStream.buffer,
			lastUpdateTime: firstStream.lastUpdateTime,
			maxUpdateTimeMs: 100,
			now: new Date("2026-01-01T00:00:00.020Z"),
		});

		expect(secondStream.message.updates).toHaveLength(1);
		expect(secondStream.message.updates?.[0]).toEqual({
			type: MessageUpdateType.Stream,
			token: "Hello",
		});
		expect(secondStream.buffer).toBe("Hello");

		const flushWithTool = processClientUpdate({
			message: secondStream.message,
			update: {
				type: MessageUpdateType.Tool,
				subtype: MessageToolUpdateType.Call,
				uuid: "tool-1",
				call: { name: "search", parameters: { q: "hello" } },
			},
			disableStream: false,
			buffer: secondStream.buffer,
			lastUpdateTime: secondStream.lastUpdateTime,
			maxUpdateTimeMs: 100,
			now: new Date("2026-01-01T00:00:00.030Z"),
		});

		expect(flushWithTool.message.content).toBe("Hello");
		expect(flushWithTool.buffer).toBe("");
		expect(flushWithTool.message.updates).toHaveLength(2);
		expect(flushWithTool.lastUpdateTime.toISOString()).toBe("2026-01-01T00:00:00.030Z");
	});

	it("flushes buffered content when debounce threshold is exceeded", () => {
		const result = processClientUpdate({
			message: createMessage(),
			update: { type: MessageUpdateType.Stream, token: "chunk" },
			disableStream: false,
			buffer: "",
			lastUpdateTime: new Date("2026-01-01T00:00:00.000Z"),
			maxUpdateTimeMs: 5,
			now: new Date("2026-01-01T00:00:00.010Z"),
		});

		expect(result.buffer).toBe("");
		expect(result.message.content).toBe("chunk");
	});

	it("keeps streamed updates buffered when stream display is disabled", () => {
		const result = processClientUpdate({
			message: createMessage(),
			update: { type: MessageUpdateType.Stream, token: "hidden" },
			disableStream: true,
			buffer: "",
			lastUpdateTime: new Date("2026-01-01T00:00:00.000Z"),
			maxUpdateTimeMs: 100,
		});

		expect(result.message.content).toBe("");
		expect(result.buffer).toBe("");
		expect(result.effects.setPendingFalse).toBe(false);
		expect(result.message.updates).toHaveLength(1);
	});

	it("applies final answer merging with tool awareness", () => {
		const message = createMessage({
			content: "Draft",
			updates: [
				{
					type: MessageUpdateType.Tool,
					subtype: MessageToolUpdateType.Call,
					uuid: "tool-1",
					call: { name: "tool", parameters: {} },
				},
			],
		});

		const result = processClientUpdate({
			message,
			update: { type: MessageUpdateType.FinalAnswer, text: "Final", interrupted: false },
			disableStream: false,
			buffer: "",
			lastUpdateTime: new Date("2026-01-01T00:00:00.000Z"),
			maxUpdateTimeMs: 100,
		});

		expect(result.message.content).toBe(
			mergeFinalAnswer({
				currentContent: "Draft",
				finalText: "Final",
				interrupted: false,
				hadTools: true,
			})
		);
	});

	it("replaces streamed content with final answer when no tools were used", () => {
		const result = processClientUpdate({
			message: createMessage({ content: "Draft", updates: [] }),
			update: { type: MessageUpdateType.FinalAnswer, text: "Final", interrupted: false },
			disableStream: false,
			buffer: "",
			lastUpdateTime: new Date(),
			maxUpdateTimeMs: 100,
		});

		expect(result.message.content).toBe("Final");
	});

	it("handles status errors including subscription-required status", () => {
		const subscriptionError = processClientUpdate({
			message: createMessage(),
			update: {
				type: MessageUpdateType.Status,
				status: MessageUpdateStatus.Error,
				message: "Payment required",
				statusCode: 402,
			},
			disableStream: false,
			buffer: "",
			lastUpdateTime: new Date(),
			maxUpdateTimeMs: 100,
		});

		expect(subscriptionError.effects.showSubscribeModal).toBe(true);
		expect(subscriptionError.effects.errorMessage).toBeUndefined();

		const genericError = processClientUpdate({
			message: createMessage(),
			update: {
				type: MessageUpdateType.Status,
				status: MessageUpdateStatus.Error,
				message: "Something went wrong",
			},
			disableStream: false,
			buffer: "",
			lastUpdateTime: new Date(),
			maxUpdateTimeMs: 100,
		});

		expect(genericError.effects.showSubscribeModal).toBe(false);
		expect(genericError.effects.errorMessage).toBe("Something went wrong");

		const defaultMessageError = processClientUpdate({
			message: createMessage(),
			update: {
				type: MessageUpdateType.Status,
				status: MessageUpdateStatus.Error,
			},
			disableStream: false,
			buffer: "",
			lastUpdateTime: new Date(),
			maxUpdateTimeMs: 100,
		});

		expect(defaultMessageError.effects.errorMessage).toBe("An error has occurred");
	});

	it("emits title effects and merges file/router updates", () => {
		const withTitle = processClientUpdate({
			message: createMessage(),
			update: { type: MessageUpdateType.Title, title: "New title" },
			disableStream: false,
			buffer: "",
			lastUpdateTime: new Date(),
			maxUpdateTimeMs: 100,
		});
		expect(withTitle.effects.title).toBe("New title");

		const withFile = processClientUpdate({
			message: withTitle.message,
			update: {
				type: MessageUpdateType.File,
				name: "image.png",
				sha: "sha256",
				mime: "image/png",
			},
			disableStream: false,
			buffer: withTitle.buffer,
			lastUpdateTime: withTitle.lastUpdateTime,
			maxUpdateTimeMs: 100,
		});
		expect(withFile.message.files).toEqual([
			{ type: "hash", value: "sha256", mime: "image/png", name: "image.png" },
		]);

		const withRouterMetadata = processClientUpdate({
			message: {
				...withFile.message,
				routerMetadata: { route: "route-a", model: "model-a" },
			},
			update: {
				type: MessageUpdateType.RouterMetadata,
				route: "",
				model: "",
				provider: "hf-inference" as never,
			},
			disableStream: false,
			buffer: withFile.buffer,
			lastUpdateTime: withFile.lastUpdateTime,
			maxUpdateTimeMs: 100,
		});

		expect(withRouterMetadata.message.routerMetadata).toEqual({
			route: "route-a",
			model: "model-a",
			provider: "hf-inference",
		});
	});

	it("ignores keepalive updates while still flushing buffered content", () => {
		const result = processClientUpdate({
			message: createMessage(),
			update: {
				type: MessageUpdateType.Status,
				status: MessageUpdateStatus.KeepAlive,
			},
			disableStream: false,
			buffer: "buffered",
			lastUpdateTime: new Date("2026-01-01T00:00:00.000Z"),
			maxUpdateTimeMs: 100,
			now: new Date("2026-01-01T00:00:01.000Z"),
		});

		expect(result.message.updates).toEqual([]);
		expect(result.message.content).toBe("buffered");
		expect(result.buffer).toBe("");
	});

	it("stores non-error status updates without extra effects", () => {
		const result = processClientUpdate({
			message: createMessage(),
			update: {
				type: MessageUpdateType.Status,
				status: MessageUpdateStatus.Finished,
			},
			disableStream: false,
			buffer: "",
			lastUpdateTime: new Date(),
			maxUpdateTimeMs: 100,
		});

		expect(result.message.updates).toContainEqual({
			type: MessageUpdateType.Status,
			status: MessageUpdateStatus.Finished,
		});
		expect(result.effects.errorMessage).toBeUndefined();
		expect(result.effects.showSubscribeModal).toBe(false);
	});

	it("handles messages with undefined updates", () => {
		const result = processClientUpdate({
			message: createMessage({ updates: undefined }),
			update: {
				type: MessageUpdateType.Status,
				status: MessageUpdateStatus.Finished,
			},
			disableStream: false,
			buffer: "",
			lastUpdateTime: new Date(),
			maxUpdateTimeMs: 100,
		});

		expect(result.message.updates).toEqual([
			{
				type: MessageUpdateType.Status,
				status: MessageUpdateStatus.Finished,
			},
		]);
	});
});
