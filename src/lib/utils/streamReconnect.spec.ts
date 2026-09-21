import { describe, expect, test } from "vitest";

import type { Message } from "$lib/types/Message";
import { MessageUpdateType, type MessageUpdate } from "$lib/types/MessageUpdate";
import type { TurnStatus } from "$lib/types/TurnState";
import { isTransportFailure, reconnectAction, reconnectBackoffMs } from "./streamReconnect";

const turnState = (state: TurnStatus): MessageUpdate => ({
	type: MessageUpdateType.TurnState,
	state,
	serverNow: 0,
});

function assistant(overrides: Partial<Message> = {}): Message {
	return {
		from: "assistant",
		id: "assistant-1" as Message["id"],
		content: "",
		children: [],
		generationId: "gen-1",
		updates: [turnState("running")],
		...overrides,
	};
}

const idle = { writeInFlight: false, subscribed: false, resyncing: false };

describe("reconnectAction", () => {
	test("replaces the connection of a held subscription", () => {
		expect(reconnectAction({ ...idle, lastAssistant: assistant(), subscribed: true })).toBe(
			"resubscribe"
		);
	});

	test.each<TurnStatus>(["running", "waiting", "awaiting_input"])(
		"resyncs a %s turn that has no subscription",
		(state) => {
			const lastAssistant = assistant({ updates: [turnState(state)] });
			expect(reconnectAction({ ...idle, lastAssistant })).toBe("resync");
		}
	);

	test.each<TurnStatus>(["done", "failed"])("never reconnects a %s turn", (state) => {
		const lastAssistant = assistant({ updates: [turnState(state)] });
		expect(reconnectAction({ ...idle, lastAssistant })).toBe("none");
		expect(reconnectAction({ ...idle, lastAssistant, subscribed: true })).toBe("none");
	});

	test("never reconnects an interrupted turn", () => {
		const lastAssistant = assistant({ interrupted: true });
		expect(reconnectAction({ ...idle, lastAssistant })).toBe("none");
	});

	test("leaves the turn to the POST stream that is still writing it", () => {
		expect(
			reconnectAction({
				lastAssistant: assistant(),
				writeInFlight: true,
				subscribed: false,
				resyncing: true,
			})
		).toBe("none");
	});

	test("does nothing without an assistant message or a generation to subscribe to", () => {
		expect(reconnectAction({ ...idle, lastAssistant: undefined })).toBe("none");
		expect(
			reconnectAction({ ...idle, lastAssistant: assistant({ generationId: undefined }) })
		).toBe("none");
	});

	test("hurries a resync that is backing off, even for a local placeholder message", () => {
		const placeholder = assistant({ generationId: undefined, updates: [] });
		expect(reconnectAction({ ...idle, lastAssistant: placeholder, resyncing: true })).toBe(
			"resync"
		);
	});

	test("prefers the held subscription over a resync still winding down", () => {
		expect(
			reconnectAction({
				lastAssistant: assistant(),
				writeInFlight: false,
				subscribed: true,
				resyncing: true,
			})
		).toBe("resubscribe");
	});
});

describe("reconnectBackoffMs", () => {
	test("doubles from one second and caps at thirty", () => {
		expect([0, 1, 2, 3, 4, 5, 6, 7, 20].map(reconnectBackoffMs)).toEqual([
			0, 1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000,
		]);
	});
});

describe("isTransportFailure", () => {
	test("is true only for the TypeError fetch rejects with when the connection fails", () => {
		expect(isTransportFailure(new TypeError("Failed to fetch"))).toBe(true);
		expect(isTransportFailure(new TypeError("Load failed"))).toBe(true);
	});

	test("is false for HTTP errors, aborts, and non-errors", () => {
		expect(isTransportFailure(new Error("Request failed with status code 429"))).toBe(false);
		expect(isTransportFailure(new DOMException("aborted", "AbortError"))).toBe(false);
		expect(isTransportFailure("Failed to fetch")).toBe(false);
		expect(isTransportFailure(undefined)).toBe(false);
	});
});
