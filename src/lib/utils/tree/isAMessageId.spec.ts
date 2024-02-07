import { describe, expect, it } from "vitest";
import { isAMessageId } from "./isAMessageId";

describe("isAMessageId", () => {
	it("should return true for a valid message id", () => {
		expect(isAMessageId("1-2-3-4-5")).toBe(true);
	});
	it("should return false for an invalid message id", () => {
		expect(isAMessageId("1-2-3-4")).toBe(false);
	});
	it("should return false for an empty string", () => {
		expect(isAMessageId("")).toBe(false);
	});
});
