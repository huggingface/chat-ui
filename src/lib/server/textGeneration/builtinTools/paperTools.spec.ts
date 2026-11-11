import { describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";

const pages = vi.hoisted(() => ({ value: [] as string[] }));

vi.mock("$lib/server/papers/store", () => ({
	findStoredPaper: vi.fn(async () => ({
		id: "1706.03762",
		sha: "a".repeat(64),
		pages: pages.value.length,
		title: "Attention",
		source: "",
	})),
	loadPaperPages: vi.fn(async () => pages.value),
	savePaper: vi.fn(),
}));

import { createReadPaperTool } from "./paperTools";

const ctx = { uuid: "u", toolCallId: "t", conversationId: new ObjectId() };

async function read(spec: string) {
	const result = await createReadPaperTool().execute({ paper: "1706.03762", pages: spec }, ctx);
	if (!("resultText" in result)) throw new Error(JSON.stringify(result));
	return result.resultText;
}

describe("read_paper", () => {
	it("caps the text even when the first page alone is over budget", async () => {
		pages.value = ["x".repeat(100_000), "second page"];
		const text = await read("1-2");
		expect(text.length).toBeLessThan(49_000);
		expect(text).toContain("Page 1 was cut short");
		expect(text).toContain("Stopped before page 2");
		expect(text).not.toContain("second page");
	});

	it("reads several short pages whole", async () => {
		pages.value = ["one", "two", "three"];
		const text = await read("1,3");
		expect(text).toContain("--- page 1 ---\none");
		expect(text).toContain("--- page 3 ---\nthree");
		expect(text).not.toContain("cut short");
	});
});
