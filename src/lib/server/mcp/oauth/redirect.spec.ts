import { describe, expect, it } from "vitest";
import { safeLocalReturnPath } from "./redirect";

describe("safeLocalReturnPath", () => {
	it("preserves local paths and query strings", () => {
		expect(safeLocalReturnPath("/conversation/123?from=mcp")).toBe("/conversation/123?from=mcp");
	});

	it.each([
		"https://attacker.example/path",
		"//attacker.example/path",
		"/\\attacker.example/path",
		"\\\\attacker.example/path",
		"javascript:alert(1)",
	])("rejects a non-local return target: %s", (target) => {
		expect(safeLocalReturnPath(target)).toBe("/");
	});

	it("drops fragments from the return target", () => {
		expect(safeLocalReturnPath("/conversation/123#secret")).toBe("/conversation/123");
	});
});
