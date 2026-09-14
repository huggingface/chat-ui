import { describe, expect, it } from "vitest";
import { createTrackioTool, CREATE_TRACKIO_TOOL_NAME } from "./createTrackioTool";
import { extractTrackioDashboards } from "$lib/utils/trackio";
import type { BuiltinToolContext } from "./types";

const ctx = {} as BuiltinToolContext;
const tool = (namespace?: string) => createTrackioTool(() => namespace);

describe("create_trackio", () => {
	it("returns a dashboard chat-ui can frame without reading the model's output", async () => {
		// The point of the tool: the URL is chat-ui's own, so the pane never
		// depends on parsing a script or catching a log line.
		const result = await tool("pngwn").execute({ project: "smollm2-capybara-sft" }, ctx);

		if (!("resultText" in result)) throw new Error("expected a result");
		expect(extractTrackioDashboards(result.resultText)).toEqual([
			{
				url: "https://pngwn-smollm2-capybara-sft-trackio.hf.space",
				label: "pngwn/smollm2-capybara-sft-trackio",
				// Carried so the chip can poll: this Space does not exist yet.
				spaceId: "pngwn/smollm2-capybara-sft-trackio",
			},
		]);
	});

	it("hands back the exact init call, since an invented id points nowhere", async () => {
		const result = await tool("pngwn").execute({ project: "tiny sft" }, ctx);

		if (!("resultText" in result)) throw new Error("expected a result");
		expect(result.resultText).toContain('space_id="pngwn/tiny-sft-trackio"');
		expect(result.resultText).toContain('project="tiny sft"');
	});

	it("refuses rather than guessing when there is no namespace", async () => {
		const result = await tool(undefined).execute({ project: "x" }, ctx);

		expect(result).toHaveProperty("error");
		if (!("error" in result)) throw new Error("expected an error");
		expect(result.error).toContain("hf_whoami");
	});

	it("refuses without a project", async () => {
		expect(await tool("pngwn").execute({}, ctx)).toEqual({ error: "No project name provided." });
	});

	it("is exempt from tool restraint, like the other run-shaping builtins", () => {
		expect(tool("pngwn").exemptFromToolRestraint).toBe(true);
		expect(tool("pngwn").name).toBe(CREATE_TRACKIO_TOOL_NAME);
	});
});
