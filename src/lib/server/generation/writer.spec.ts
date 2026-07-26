import { afterEach, beforeAll, describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import { randomUUID } from "node:crypto";
import { collections, ready } from "$lib/server/database";
import { createGenerationWriter, mergedStreamToken } from "./writer";
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

describe.sequential("generation writer cursor", () => {
	beforeAll(async () => {
		await ready;
	});

	afterEach(async () => {
		await Promise.all([
			collections.conversations.deleteMany({}),
			collections.generations.deleteMany({}),
			collections.generationEvents.deleteMany({}),
		]);
	});

	it("seals the event covered by a synchronously captured cursor", async () => {
		const conversationId = new ObjectId();
		const messageId = randomUUID();
		const generationId = randomUUID();
		const now = new Date();
		let content = "";

		await collections.conversations.insertOne({
			_id: conversationId,
			messages: [
				{
					id: messageId,
					from: "assistant",
					content,
					updates: [],
					createdAt: now,
					updatedAt: now,
				},
			],
			createdAt: now,
			updatedAt: now,
		} as never);

		const writer = await createGenerationWriter({
			generationId,
			conversationId,
			messageId,
			snapshot: () => ({ content }),
		});

		content += "alpha ";
		writer.push(text("alpha "));

		// This is how the POST handler snapshots on client detach: capture the
		// cursor and content synchronously, then persist them together.
		const materializedSeq = writer.currentSeq();
		const materializedContent = content;

		// A later token must not merge into the pending event already covered by
		// materializedSeq, which would make replay disagree with the captured content.
		content += "beta ";
		writer.push(text("beta "));
		await writer.finish({ status: "completed" });

		const events = await collections.generationEvents
			.find({ generationId, seq: { $lte: materializedSeq } })
			.sort({ seq: 1 })
			.toArray();
		const replayed = events
			.filter((event) => event.event.type === MessageUpdateType.Stream)
			.map((event) => (event.event.type === MessageUpdateType.Stream ? event.event.token : ""))
			.join("");

		expect(materializedSeq).toBeGreaterThan(0);
		expect(replayed).toBe(materializedContent);
	});
});
