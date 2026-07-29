import { describe, expect, it } from "vitest";
import { formatScreenshotNotes } from "./screenshotNotes";

describe("formatScreenshotNotes", () => {
	it("numbers notes in order", () => {
		expect(formatScreenshotNotes(["button overlaps", "too cramped"])).toBe(
			"Screenshot notes:\n1. button overlaps\n2. too cramped"
		);
	});

	it("returns undefined when there are no usable notes", () => {
		expect(formatScreenshotNotes([])).toBeUndefined();
		expect(formatScreenshotNotes(["", "   "])).toBeUndefined();
	});

	it("trims and skips empty entries while keeping numbering dense", () => {
		expect(formatScreenshotNotes(["  first  ", "", "second"])).toBe(
			"Screenshot notes:\n1. first\n2. second"
		);
	});
});
