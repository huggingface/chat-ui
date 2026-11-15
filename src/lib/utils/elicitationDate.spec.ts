import { describe, it, expect, afterEach } from "vitest";
import { forDateInput } from "./elicitationDate";

const original = process.env.TZ;
afterEach(() => {
	process.env.TZ = original;
});

// West of UTC is the case that matters: a date-only string parses as UTC midnight, so a
// naive local round-trip lands on the previous day there and nowhere else.
const ZONES = ["UTC", "Europe/London", "America/Los_Angeles", "Pacific/Kiritimati"];

describe("a date-only default", () => {
	for (const zone of ZONES) {
		it(`keeps its own day in ${zone}`, () => {
			process.env.TZ = zone;
			expect(forDateInput("2026-09-01", "date")).toBe("2026-09-01");
			expect(forDateInput("2026-01-15", "date")).toBe("2026-01-15");
		});
	}
});

describe("an RFC 3339 default", () => {
	it("is narrowed to what a date input accepts", () => {
		process.env.TZ = "UTC";
		expect(forDateInput("2026-09-01T09:30:00Z", "date")).toBe("2026-09-01");
	});

	it("is narrowed to local wall-clock time for a datetime-local input", () => {
		process.env.TZ = "UTC";
		expect(forDateInput("2026-09-01T09:30:00Z", "date-time")).toBe("2026-09-01T09:30");
		process.env.TZ = "America/Los_Angeles";
		expect(forDateInput("2026-09-01T09:30:00Z", "date-time")).toBe("2026-09-01T02:30");
	});

	it("keeps an offset other than Z", () => {
		process.env.TZ = "UTC";
		expect(forDateInput("2026-09-01T09:30:00+02:00", "date-time")).toBe("2026-09-01T07:30");
	});
});

describe("a value no date control can show", () => {
	it("becomes empty rather than garbage in a datetime-local input", () => {
		expect(forDateInput("whenever", "date-time")).toBe("");
	});
});
