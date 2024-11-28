import MarkdownRenderer from "./MarkdownRenderer.svelte";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/svelte";

describe("MarkdownRenderer", () => {
	it("renders", () => {
		render(MarkdownRenderer, { content: "Hello, world!" });
	});
	it("renders headings", () => {
		render(MarkdownRenderer, { content: "# Hello, world!" });
		expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
	});
	it("renders links", () => {
		render(MarkdownRenderer, { content: "[Hello, world!](https://example.com)" });
		const link = screen.getByRole("link", { name: "Hello, world!" });
		expect(link).toBeInTheDocument();
		expect(link).toHaveAttribute("href", "https://example.com");
		expect(link).toHaveAttribute("target", "_blank");
		expect(link).toHaveAttribute("rel", "noreferrer");
	});
	it("renders inline codespans", () => {
		render(MarkdownRenderer, { content: "`foobar`" });
		expect(screen.getByText("foobar")).toHaveProperty("tagName", "CODE");
	});
	it("renders block codes", () => {
		render(MarkdownRenderer, { content: "```foobar```" });
		expect(screen.getByText("foobar")).toHaveProperty("tagName", "CODE");
	});
	it("renders sources correctly", () => {
		const props = {
			content: "Hello there [1]",
			sources: [
				{
					title: "foo",
					link: "https://example.com",
				},
			],
		};
		render(MarkdownRenderer, props);

		const link = screen.getByRole("link");
		expect(link).toBeInTheDocument();
		expect(link).toHaveAttribute("href", "https://example.com");
		expect(link).toHaveAttribute("target", "_blank");
		expect(link).toHaveAttribute("rel", "noreferrer");
	});
	it("handles groups of citations", () => {
		render(MarkdownRenderer, {
			content: "Hello there [1], [2], [3]",
			sources: [
				{
					title: "foo",
					link: "https://example.com",
				},
				{
					title: "bar",
					link: "https://example.com",
				},
				{
					title: "baz",
					link: "https://example.com",
				},
			],
		});
		expect(screen.getAllByRole("link")).toHaveLength(3);
	});
	it("doesnt render raw html directly", () => {
		render(MarkdownRenderer, { content: "<button>Click me</button>" });
		expect(screen.queryByRole("button")).not.toBeInTheDocument();
		expect(screen.queryByRole("paragraph")).toHaveTextContent("<button>Click me</button>");
	});
});
