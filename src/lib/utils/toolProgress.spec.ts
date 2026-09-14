import { describe, it, expect } from "vitest";
import { MessageToolUpdateType, MessageUpdateType } from "$lib/types/MessageUpdate";
import type { MessageToolProgressUpdate } from "$lib/types/MessageUpdate";
import { formatToolProgressCount, formatToolProgressLines } from "./toolProgress";

const progress = (fields: Partial<MessageToolProgressUpdate>): MessageToolProgressUpdate =>
	({
		type: MessageUpdateType.Tool,
		subtype: MessageToolUpdateType.Progress,
		uuid: "u1",
		progress: 4,
		...fields,
	}) as MessageToolProgressUpdate;

describe("formatToolProgressCount", () => {
	it("counts against the total when there is one", () => {
		expect(formatToolProgressCount(progress({ progress: 4, total: 30 }))).toBe("4/30");
	});

	it("counts alone when there is no total", () => {
		expect(formatToolProgressCount(progress({ progress: 4, total: undefined }))).toBe("4");
	});

	it("is empty with no progress at all", () => {
		expect(formatToolProgressCount(undefined)).toBe("");
	});
});

describe("formatToolProgressLines", () => {
	it("splits concurrent calls onto their own lines", () => {
		const lines = formatToolProgressLines(
			progress({ message: "▸ hf_sandbox_exec {...}\n▸ hf_sandbox_fs {...}" })
		);

		expect(lines).toEqual(["▸ hf_sandbox_exec {...}", "▸ hf_sandbox_fs {...}"]);
	});

	it("keeps a single call as one line", () => {
		expect(formatToolProgressLines(progress({ message: "Starting sandbox sub-agent" }))).toEqual([
			"Starting sandbox sub-agent",
		]);
	});

	it("drops blank lines rather than rendering gaps", () => {
		expect(formatToolProgressLines(progress({ message: "one\n\n  \ntwo" }))).toEqual([
			"one",
			"two",
		]);
	});

	it("is empty when there is no message, so the count can stand alone", () => {
		expect(formatToolProgressLines(progress({ message: "   " }))).toEqual([]);
		expect(formatToolProgressLines(undefined)).toEqual([]);
	});
});
