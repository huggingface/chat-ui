import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { ready } from "$lib/server/database";
import { findStoredPaper, loadPaperPages, savePaper } from "./store";

await ready;

const SHA = "c".repeat(64);
const pdf = new TextEncoder().encode("%PDF-1.4 bytes");

describe("paper store", () => {
	it("finds every id the same bytes were opened as", async () => {
		const conversation = new ObjectId();
		const base = { sha: SHA, pages: 1, title: "Same bytes", source: "" };
		await savePaper(conversation, pdf, ["text"], { ...base, id: `pdf-${SHA.slice(0, 10)}` });
		await savePaper(conversation, pdf, ["text"], { ...base, id: "1706.03762" });

		expect(await findStoredPaper(conversation, `pdf-${SHA.slice(0, 10)}`)).toMatchObject({
			sha: SHA,
		});
		expect(await findStoredPaper(conversation, "1706.03762")).toMatchObject({
			id: "1706.03762",
			sha: SHA,
		});
		expect(await loadPaperPages(conversation, SHA)).toEqual(["text"]);
	});

	it("keeps each conversation's papers to itself", async () => {
		const mine = new ObjectId();
		await savePaper(mine, pdf, ["text"], {
			id: "2401.00001",
			sha: "d".repeat(64),
			pages: 1,
			title: "Mine",
			source: "",
		});
		expect(await findStoredPaper(new ObjectId(), "2401.00001")).toBeNull();
	});
});
