import { describe, expect, it } from "vitest";
import { formatVirtualFileRef, parseVirtualFileRef } from "./refs";

describe("parseVirtualFileRef", () => {
	it("reads a bare reference as the latest version", () => {
		expect(parseVirtualFileRef("v-file://train.py")).toEqual({
			ref: "v-file://train.py",
			name: "train.py",
		});
		expect(parseVirtualFileRef("  v-file://configs/sft.yaml\n")).toEqual({
			ref: "v-file://configs/sft.yaml",
			name: "configs/sft.yaml",
		});
	});

	it("reads a pinned version", () => {
		expect(parseVirtualFileRef("v-file://train.py@v3")).toEqual({
			ref: "v-file://train.py@v3",
			name: "train.py",
			version: 3,
		});
	});

	it("is not a reference inside a longer string, or in any other shape", () => {
		expect(parseVirtualFileRef("# see v-file://train.py\nimport torch")).toBeUndefined();
		expect(parseVirtualFileRef("v-file://train.py extra")).toBeUndefined();
		expect(parseVirtualFileRef("v-file://train.py@3")).toBeUndefined();
		expect(parseVirtualFileRef("v-file://")).toBeUndefined();
		expect(parseVirtualFileRef("file://train.py")).toBeUndefined();
		expect(parseVirtualFileRef(42)).toBeUndefined();
		expect(parseVirtualFileRef(undefined)).toBeUndefined();
	});

	it("round-trips through formatVirtualFileRef", () => {
		expect(parseVirtualFileRef(formatVirtualFileRef("a/b.py"))).toEqual({
			ref: "v-file://a/b.py",
			name: "a/b.py",
		});
		expect(parseVirtualFileRef(formatVirtualFileRef("a.py", 7))).toMatchObject({ version: 7 });
	});
});
