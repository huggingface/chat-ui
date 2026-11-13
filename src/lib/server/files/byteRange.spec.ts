import { describe, expect, it } from "vitest";
import { parseByteRange } from "./byteRange";

describe("parseByteRange", () => {
	it("reads the ranges pdf.js and browsers send", () => {
		expect(parseByteRange(null, 100)).toBeNull();
		expect(parseByteRange("bytes=0-9", 100)).toEqual([0, 9]);
		expect(parseByteRange("bytes=90-", 100)).toEqual([90, 99]);
		expect(parseByteRange("bytes=-10", 100)).toEqual([90, 99]);
		expect(parseByteRange("bytes=50-500", 100)).toEqual([50, 99]);
	});

	it("refuses what it cannot serve", () => {
		expect(parseByteRange("bytes=100-", 100)).toBe("bad");
		expect(parseByteRange("bytes=9-0", 100)).toBe("bad");
		expect(parseByteRange("bytes=-0", 100)).toBe("bad");
		expect(parseByteRange("bytes=0-1,5-6", 100)).toBe("bad");
		expect(parseByteRange("items=0-1", 100)).toBe("bad");
	});
});
