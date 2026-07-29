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

	it("indents continuation lines of multiline notes", () => {
		expect(formatScreenshotNotes(["first line\nsecond line", "plain"])).toBe(
			"Screenshot notes:\n1. first line\n   second line\n2. plain"
		);
	});

	it("names the screenshot in the header so stacked blocks stay apart", () => {
		expect(formatScreenshotNotes(["overlaps"], '"Pomodoro Timer" (v2)')).toBe(
			'Notes on the "Pomodoro Timer" (v2) screenshot:\n1. overlaps'
		);
	});
});
