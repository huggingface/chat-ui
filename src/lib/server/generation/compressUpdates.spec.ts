import { describe, expect, it } from "vitest";
import { compressUpdatesForStorage } from "./compressUpdates";
import {
	MessageToolUpdateType,
	MessageUpdateStatus,
	MessageUpdateType,
} from "$lib/types/MessageUpdate";
import type { MessageUpdate } from "$lib/types/MessageUpdate";

const call = (uuid: string): MessageUpdate => ({
	type: MessageUpdateType.Tool,
	subtype: MessageToolUpdateType.Call,
	uuid,
	call: { name: "hf_jobs", parameters: {} },
});
const progress = (uuid: string): MessageUpdate =>
	({
		type: MessageUpdateType.Tool,
		subtype: MessageToolUpdateType.Progress,
		uuid,
		progress: 1,
	}) as unknown as MessageUpdate;
const result = (uuid: string): MessageUpdate =>
	({
		type: MessageUpdateType.Tool,
		subtype: MessageToolUpdateType.Result,
		uuid,
		result: { status: 0, call: { name: "hf_jobs", parameters: {} }, outputs: [] },
	}) as unknown as MessageUpdate;
const token = (text: string): MessageUpdate => ({ type: MessageUpdateType.Stream, token: text });
const keepAlive: MessageUpdate = {
	type: MessageUpdateType.Status,
	status: MessageUpdateStatus.KeepAlive,
};

describe("compressUpdatesForStorage", () => {
	it("drops progress notifications but keeps the call and its result", () => {
		// Progress is live-only: 59,487 of one real message's 73,994 updates were
		// progress ticks, and a stored tick tells a reader nothing the result does
		// not. Dropping them is what keeps a polling run inside Mongo's 16MB
		// document limit, past which the conversation can never be written again.
		const compressed = compressUpdatesForStorage([
			call("a"),
			...Array.from({ length: 500 }, () => progress("a")),
			result("a"),
		]);

		expect(compressed).toHaveLength(2);
		expect(compressed?.map((u) => u.type === MessageUpdateType.Tool && u.subtype)).toEqual([
			MessageToolUpdateType.Call,
			MessageToolUpdateType.Result,
		]);
	});

	it("still drops keepalives and still stores stream tokens as length markers", () => {
		const compressed = compressUpdatesForStorage([keepAlive, token("hello"), call("a")]);

		expect(compressed).toHaveLength(2);
		const [stream] = compressed ?? [];
		expect(stream).toMatchObject({ type: MessageUpdateType.Stream, token: "", len: 5 });
	});

	it("keeps a normal message untouched apart from that", () => {
		const updates = [call("a"), result("a"), call("b"), result("b")];
		expect(compressUpdatesForStorage(updates)).toEqual(updates);
	});

	it("sheds stream markers before tool history when over the cap", () => {
		// The text itself lives on the message; a marker only says where a tool
		// card sat relative to it. The calls and results are the transcript.
		const updates = [
			...Array.from({ length: 6000 }, (_, i) => token(`t${i}`)),
			...Array.from({ length: 100 }, (_, i) => call(`c${i}`)),
		];

		const compressed = compressUpdatesForStorage(updates) ?? [];

		expect(compressed).toHaveLength(100);
		expect(compressed.every((u) => u.type === MessageUpdateType.Tool)).toBe(true);
	});

	it("keeps the most recent tool history when even that is over the cap", () => {
		const updates = Array.from({ length: 6000 }, (_, i) => call(`c${i}`));

		const compressed = compressUpdatesForStorage(updates) ?? [];

		expect(compressed).toHaveLength(5000);
		// The tail, not the head: a truncated transcript should end where the run did.
		expect(compressed.at(-1)).toEqual(call("c5999"));
	});

	it("handles an absent updates array", () => {
		expect(compressUpdatesForStorage(undefined)).toEqual([]);
	});
});
