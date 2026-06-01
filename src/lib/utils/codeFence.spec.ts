import { describe, it, expect } from "vitest";
import { parseCodeFenceInfo, languageFromFilename } from "./codeFence";

describe("parseCodeFenceInfo", () => {
	it("parses a bare language", () => {
		expect(parseCodeFenceInfo("python")).toEqual({ language: "python" });
	});

	it("parses language + filename", () => {
		expect(parseCodeFenceInfo("python app.py")).toEqual({
			language: "python",
			filename: "app.py",
		});
	});

	it("parses a bare filename and infers the language", () => {
		expect(parseCodeFenceInfo("app.py")).toEqual({ language: "python", filename: "app.py" });
	});

	it("handles directory paths", () => {
		expect(parseCodeFenceInfo("ts src/lib/foo.ts")).toEqual({
			language: "ts",
			filename: "src/lib/foo.ts",
		});
	});

	it("ignores a descriptive remainder that is not a filename", () => {
		expect(parseCodeFenceInfo("js some example")).toEqual({ language: "js" });
	});

	it("does not treat ordinary language tags as filenames", () => {
		expect(parseCodeFenceInfo("diff")).toEqual({ language: "diff" });
		expect(parseCodeFenceInfo("mermaid")).toEqual({ language: "mermaid" });
	});

	it("handles empty / missing info", () => {
		expect(parseCodeFenceInfo("")).toEqual({ language: "" });
		expect(parseCodeFenceInfo(undefined)).toEqual({ language: "" });
		expect(parseCodeFenceInfo(null)).toEqual({ language: "" });
	});
});

describe("languageFromFilename", () => {
	it("maps known extensions", () => {
		expect(languageFromFilename("app.py")).toBe("python");
		expect(languageFromFilename("main.go")).toBe("go");
		expect(languageFromFilename("Component.tsx")).toBe("typescript");
	});

	it("returns empty for unknown or extension-less names", () => {
		expect(languageFromFilename("a.unknownext")).toBe("");
		expect(languageFromFilename("Makefile")).toBe("");
	});
});
