import { describe, it, expect } from "vitest";
import { mergedStreamToken } from "./writer";
import {
	MessageUpdateType,
	MessageReasoningUpdateType,
	MessageUpdateStatus,
	type MessageUpdate,
} from "$lib/types/MessageUpdate";

const text = (token: string): MessageUpdate => ({ type: MessageUpdateType.Stream, token });
const reasoning = (token: string): MessageUpdate => ({
	type: MessageUpdateType.Reasoning,
	subtype: MessageReasoningUpdateType.Stream,
	token,
});

describe("mergedStreamToken", () => {
	it("merges consecutive text tokens", () => {
		const merged = mergedStreamToken(text("hello "), text("world"));
		expect(merged).toEqual({ type: MessageUpdateType.Stream, token: "hello world" });
	});

	// The regression: reasoning models stream per-token, and without this each token
	// would hit the writer's immediate-flush path and reintroduce write amplification.
	it("merges consecutive reasoning tokens", () => {
		const merged = mergedStreamToken(reasoning("let me "), reasoning("think"));
		expect(merged).toEqual({
			type: MessageUpdateType.Reasoning,
			subtype: MessageReasoningUpdateType.Stream,
			token: "let me think",
		});
	});

	it("never merges reasoning into text or text into reasoning", () => {
		expect(mergedStreamToken(text("answer"), reasoning("think"))).toBeNull();
		expect(mergedStreamToken(reasoning("think"), text("answer"))).toBeNull();
	});

	it("does not merge non-stream updates", () => {
		const status: MessageUpdate = {
			type: MessageUpdateType.Status,
			status: MessageUpdateStatus.Finished,
		};
		const reasoningStatus: MessageUpdate = {
			type: MessageUpdateType.Reasoning,
			subtype: MessageReasoningUpdateType.Status,
			status: "thinking",
		};
		expect(mergedStreamToken(status, text("x"))).toBeNull();
		expect(mergedStreamToken(text("x"), status)).toBeNull();
		// A reasoning *status* is not a stream token, so it never coalesces either.
		expect(mergedStreamToken(reasoningStatus, reasoning("x"))).toBeNull();
	});

	it("returns null when there is no tail to merge into", () => {
		expect(mergedStreamToken(undefined, text("x"))).toBeNull();
		expect(mergedStreamToken(undefined, reasoning("x"))).toBeNull();
	});
});
