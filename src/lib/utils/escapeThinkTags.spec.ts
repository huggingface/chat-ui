import { describe, it, expect } from "vitest";
import { createThinkTagEscaper, escapeThinkTags, unescapeThinkTags } from "./escapeThinkTags";
import { THINK_BLOCK_REGEX } from "./messageBlocks";

const trace =
	'append "<think>\\n\\n</think>" to skip thinking; an empty <THINK></THINK> disables it';

describe("escapeThinkTags", () => {
	it("leaves reasoning without tags untouched", () => {
		expect(escapeThinkTags("a < b and <|im_start|>")).toBe("a < b and <|im_start|>");
	});

	it("keeps literal tags inside a wrapped block from closing it early", () => {
		const content = `<think>${escapeThinkTags(trace)}</think>Answer.`;
		const blocks = content.split(THINK_BLOCK_REGEX).filter(Boolean);
		expect(blocks).toEqual([`<think>${escapeThinkTags(trace)}</think>`, "Answer."]);
	});

	it("round-trips byte for byte", () => {
		expect(unescapeThinkTags(escapeThinkTags(trace))).toBe(trace);
	});
});

describe("createThinkTagEscaper", () => {
	it("escapes a tag split across deltas", () => {
		const escaper = createThinkTagEscaper();
		const chunks = ['append "<', "/thi", 'nk>" here', " <th", "ink>"];
		const out = chunks.map((chunk) => escaper.push(chunk)).join("") + escaper.flush();
		expect(out).toBe(escapeThinkTags(chunks.join("")));
		expect(out).not.toMatch(/<\/?think>/);
	});

	it("releases a held `<` once it can no longer be a tag", () => {
		const escaper = createThinkTagEscaper();
		expect(escaper.push("a <")).toBe("a ");
		expect(escaper.push("b")).toBe("<b");
		expect(escaper.push("x </th")).toBe("x ");
		expect(escaper.flush()).toBe("</th");
		expect(escaper.flush()).toBe("");
	});
});
