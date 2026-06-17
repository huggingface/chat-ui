import { describe, expect, it } from "vitest";
import { getMessageContentLength } from "./endpointOai";

describe("getMessageContentLength", () => {
	it("returns the length of string content", () => {
		expect(getMessageContentLength({ role: "user", content: "hello world" })).toBe(11);
	});

	it("returns 0 for empty/null content", () => {
		expect(getMessageContentLength({ role: "assistant", content: null })).toBe(0);
	});

	it("sums text parts for multimodal array content, ignoring image parts", () => {
		const largeText = "a".repeat(5000);
		const message = {
			role: "user" as const,
			content: [
				{ type: "text" as const, text: largeText },
				{ type: "image_url" as const, image_url: { url: "data:image/png;base64,abcd" } },
			],
		};
		expect(getMessageContentLength(message)).toBe(5000);
	});

	it("sums multiple text parts in multimodal array content", () => {
		const message = {
			role: "user" as const,
			content: [
				{ type: "text" as const, text: "first part " },
				{ type: "image_url" as const, image_url: { url: "data:image/png;base64,abcd" } },
				{ type: "text" as const, text: "second part" },
			],
		};
		expect(getMessageContentLength(message)).toBe(22);
	});
});
