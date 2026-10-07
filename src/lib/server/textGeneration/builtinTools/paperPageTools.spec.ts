import { describe, expect, it } from "vitest";
import { spawnSync } from "child_process";
import { ObjectId } from "mongodb";
import { PAGE_TOOLS, PAPERPAGE_PREVIEW_TOOLS } from "$lib/constants/paperPage";
import { paperPagePreprompt } from "$lib/server/paperPage/prompt";
import { createPaperPageTools, PREVIEW_CHECK } from "./paperPageTools";

describe("PREVIEW_CHECK", () => {
	it("is a valid POSIX shell script", () => {
		const result = spawnSync("sh", ["-n", "-c", PREVIEW_CHECK]);
		expect(result.stderr.toString()).toBe("");
		expect(result.status).toBe(0);
	});
});

describe("PAPERPAGE_PREVIEW_TOOLS", () => {
	it("names tools the mode really has", () => {
		const names = createPaperPageTools({
			conversationId: new ObjectId(),
			hubToken: () => undefined,
		}).map((tool) => tool.name);
		for (const tool of PAPERPAGE_PREVIEW_TOOLS) expect(names).toContain(tool);
	});
});

describe("the PaperPage prompt", () => {
	it("only names page_ tools that exist", () => {
		const names = Object.values(PAGE_TOOLS) as string[];
		const mentioned = new Set(paperPagePreprompt({}).match(/\bpage_\w+/g) ?? []);
		for (const name of mentioned) expect(names).toContain(name);
		expect(mentioned.size).toBeGreaterThan(3);
	});
});
