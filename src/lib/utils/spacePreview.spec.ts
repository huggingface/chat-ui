import { describe, expect, it } from "vitest";
import { collectSpacePreviews, previewLine } from "./spacePreview";
import { MessageToolUpdateType, MessageUpdateType } from "$lib/types/MessageUpdate";
import { ToolResultStatus } from "$lib/types/Tool";
import type { Message } from "$lib/types/Message";

function assistant(id: string, name: string, text: string, status = ToolResultStatus.Success) {
	return {
		id,
		from: "assistant",
		updates: [
			{
				type: MessageUpdateType.Tool,
				subtype: MessageToolUpdateType.Result,
				uuid: id,
				result: { status, call: { name, parameters: {} }, outputs: [{ text }] },
			},
		],
	} as unknown as Message;
}

const TOOLS = ["announce_preview"];

describe("collectSpacePreviews", () => {
	it("reads the Preview line of a trusted tool's result", () => {
		const text =
			"Workshop: https://huggingface.co/spaces/u/p-dev\nPreview: https://u-p-dev.hf.space/";
		expect(collectSpacePreviews([assistant("m1", "announce_preview", text)], TOOLS)).toEqual([
			{ url: "https://u-p-dev.hf.space/", label: "u-p-dev", messageId: "m1" },
		]);
	});

	it("dedupes the same preview announced on every turn", () => {
		const text = "Preview: https://u-p-dev.hf.space/";
		const found = collectSpacePreviews(
			[assistant("m1", "announce_preview", text), assistant("m2", "announce_preview", text)],
			TOOLS
		);
		expect(found).toHaveLength(1);
	});

	it("ignores other tools, failed calls and hosts outside hf.space", () => {
		expect(
			collectSpacePreviews(
				[
					assistant("m1", "other_tool", "Preview: https://u-p-dev.hf.space/"),
					assistant(
						"m2",
						"announce_preview",
						"Preview: https://u.hf.space/",
						ToolResultStatus.Error
					),
					assistant("m3", "announce_preview", "Preview: https://evil.com/"),
					assistant("m4", "announce_preview", "Preview: https://x.hf.space@evil.com/"),
				],
				TOOLS
			)
		).toEqual([]);
	});

	it("finds what previewLine prints, and nothing without trusted tools", () => {
		const message = assistant(
			"m1",
			"announce_preview",
			`Done.\n${previewLine("u-p-dev.hf.space")}`
		);
		expect(collectSpacePreviews([message], TOOLS)).toHaveLength(1);
		expect(collectSpacePreviews([message], [])).toEqual([]);
	});
});
