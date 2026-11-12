import { describe, expect, it } from "vitest";
import type { Message } from "$lib/types/Message";
import {
	MessageToolUpdateType,
	MessageUpdateType,
	type MessageToolUpdate,
} from "$lib/types/MessageUpdate";
import { ToolResultStatus } from "$lib/types/Tool";
import { collectSpaceChecks, spaceCheckHeader, spaceChecksFromToolUpdates } from "./spaceCheck";

const call = (uuid: string, name = "check_space"): MessageToolUpdate => ({
	type: MessageUpdateType.Tool,
	subtype: MessageToolUpdateType.Call,
	uuid,
	call: { name, parameters: {} },
});
const progress = (uuid: string, message: string): MessageToolUpdate => ({
	type: MessageUpdateType.Tool,
	subtype: MessageToolUpdateType.Progress,
	uuid,
	progress: 0,
	message,
});
const result = (uuid: string, text: string, name = "check_space"): MessageToolUpdate => ({
	type: MessageUpdateType.Tool,
	subtype: MessageToolUpdateType.Result,
	uuid,
	result: {
		status: ToolResultStatus.Success,
		call: { name, parameters: {} },
		outputs: [{ text }],
	},
});

const header = spaceCheckHeader("pngwn/my_demo", "RUNNING", false);

describe("space checks", () => {
	it("opens from the live progress update of a check_space call", () => {
		expect(spaceChecksFromToolUpdates([call("a"), progress("a", header)])).toEqual([
			{
				spaceId: "pngwn/my_demo",
				url: "https://pngwn-my-demo.hf.space",
				label: "pngwn/my_demo",
				private: false,
				checkId: "a",
			},
		]);
	});

	it("keeps a result that ran the console section and drops one that did not", () => {
		const withConsole = `${header}\n\nTest call…\n\nConsole: no browser tab has this Space open, so its browser console can't be read.`;
		expect(spaceChecksFromToolUpdates([call("a"), result("a", withConsole)])).toHaveLength(1);
		expect(spaceChecksFromToolUpdates([call("b"), result("b", header)])).toEqual([]);
	});

	it("reads the private flag, and only a RUNNING header", () => {
		const priv = spaceCheckHeader("pngwn/demo", "RUNNING", true);
		expect(spaceChecksFromToolUpdates([call("a"), progress("a", priv)])[0].private).toBe(true);
		const broken = spaceCheckHeader("pngwn/demo", "RUNTIME_ERROR", false);
		expect(spaceChecksFromToolUpdates([call("a"), progress("a", broken)])).toEqual([]);
	});

	it("ignores the same text from any other tool, and a mismatched page link", () => {
		expect(spaceChecksFromToolUpdates([call("a", "hf_jobs"), progress("a", header)])).toEqual([]);
		expect(
			spaceChecksFromToolUpdates([
				call("a", "hf_jobs"),
				result("a", `${header}\nConsole: x`, "hf_jobs"),
			])
		).toEqual([]);
		const forged = "Space pngwn/demo: RUNNING — https://huggingface.co/spaces/evil/demo";
		expect(spaceChecksFromToolUpdates([call("a"), progress("a", forged)])).toEqual([]);
	});

	it("collects one item per Space with its latest check, placed at its first message", () => {
		const other = spaceCheckHeader("pngwn/other", "RUNNING", false);
		const messages = [
			{ id: "m1", from: "assistant", updates: [call("a"), progress("a", header)] },
			{ id: "m2", from: "user", updates: [] },
			{
				id: "m3",
				from: "assistant",
				updates: [call("b"), progress("b", other), call("c"), progress("c", header)],
			},
		] as unknown as Array<Pick<Message, "id" | "from" | "updates">>;
		expect(collectSpaceChecks(messages).map((c) => [c.spaceId, c.checkId, c.messageId])).toEqual([
			["pngwn/my_demo", "c", "m1"],
			["pngwn/other", "b", "m3"],
		]);
	});
});
