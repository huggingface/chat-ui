import { describe, expect, it } from "vitest";
import { collectWorkflowSpaces } from "$lib/utils/workflowSpace";
import { MessageToolUpdateType, MessageUpdateType } from "$lib/types/MessageUpdate";
import type { MessageUpdate } from "$lib/types/MessageUpdate";
import { ToolResultStatus } from "$lib/types/Tool";

const result = (name: string, text: string): MessageUpdate => ({
	type: MessageUpdateType.Tool,
	subtype: MessageToolUpdateType.Result,
	uuid: "u1",
	result: {
		status: ToolResultStatus.Success,
		call: { name, parameters: {} },
		outputs: [{ text }],
		display: true,
	},
});

const WRITTEN =
	"Public workflow Space written: https://huggingface.co/spaces/hmb/flux-vs-krea-workflow — tell the user it is public.";

describe("collectWorkflowSpaces", () => {
	it("frames the Space create_workflow wrote", () => {
		const found = collectWorkflowSpaces([
			{ id: "m1", from: "assistant", updates: [result("create_workflow", WRITTEN)] },
		]);

		expect(found).toEqual([
			{
				url: "https://hmb-flux-vs-krea-workflow.hf.space",
				label: "hmb/flux-vs-krea-workflow",
				spaceId: "hmb/flux-vs-krea-workflow",
				messageId: "m1",
				kind: "workflow",
			},
		]);
	});

	it("ignores the same URL from any other tool", () => {
		expect(
			collectWorkflowSpaces([
				{ id: "m1", from: "assistant", updates: [result("hf_jobs", WRITTEN)] },
			])
		).toEqual([]);
	});
});
