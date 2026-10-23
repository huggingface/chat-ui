import { describe, expect, it } from "vitest";
import { mlAssistantExamples } from "./mlAssistant";

describe("ML Intern suggestion chips", () => {
	it("offers a dataset review that opens the review pane", () => {
		const review = mlAssistantExamples.find((example) => example.title === "Review a dataset");
		expect(review?.prompt).toContain("let me mark whether each label is correct");
	});

	it("keeps every chip title unique", () => {
		const titles = mlAssistantExamples.map((example) => example.title);
		expect(new Set(titles).size).toBe(titles.length);
	});
});
