import { describe, expect, it } from "vitest";
import { isMessageId } from "./isMessageId";

describe("isMessageId", () => {
	it("should return true for a valid message id", () => {
		expect(isMessageId("1-2-3-4-5")).toBe(true);
	});
	it("should return false for an invalid message id", () => {
		expect(isMessageId("1-2-3-4")).toBe(false);
	});
	it("should return false for an empty string", () => {
		expect(isMessageId("")).toBe(false);
	});
});
