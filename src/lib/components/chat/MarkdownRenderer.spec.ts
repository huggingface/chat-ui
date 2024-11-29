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
	it("handles groups of sources", () => {
		render(MarkdownRenderer, {
			content: "Hello there [1], [2], [3]",
			sources: [
				{
					title: "foo",
					link: "https://foo.com",
				},
				{
					title: "bar",
					link: "https://bar.com",
				},
				{
					title: "baz",
					link: "https://baz.com",
				},
			],
		});
		expect(screen.getAllByRole("link")).toHaveLength(3);
		expect(screen.getAllByRole("link")[0]).toHaveAttribute("href", "https://foo.com");
		expect(screen.getAllByRole("link")[1]).toHaveAttribute("href", "https://bar.com");
		expect(screen.getAllByRole("link")[2]).toHaveAttribute("href", "https://baz.com");
	});
	it("does not render sources in code blocks", () => {
		render(MarkdownRenderer, {
			content: "```\narray[1]\n```",
			sources: [
				{
					title: "foo",
					link: "https://example.com",
				},
			],
		});
		expect(screen.queryByRole("link")).not.toBeInTheDocument();
	});
	it("doesnt render raw html directly", () => {
		render(MarkdownRenderer, { content: "<button>Click me</button>" });
		expect(screen.queryByRole("button")).not.toBeInTheDocument();
		expect(screen.queryByRole("paragraph")).toHaveTextContent("<button>Click me</button>");
	});
	it("renders latex", () => {
		const { baseElement } = render(MarkdownRenderer, { content: "$(oo)^2$" });
		expect(baseElement.querySelectorAll(".katex")).toHaveLength(1);
	});
	it("does not render latex in code blocks", () => {
		const { baseElement } = render(MarkdownRenderer, { content: "```\n$(oo)^2$\n```" });
		expect(baseElement.querySelectorAll(".katex")).toHaveLength(0);
	});
	it.todo("does not render latex in inline codes", () => {
		const { baseElement } = render(MarkdownRenderer, { content: "`$oo` and `$bar`" });
		expect(baseElement.querySelectorAll(".katex")).toHaveLength(0);
	});
	it.todo("does not render latex across multiple lines", () => {
		const { baseElement } = render(MarkdownRenderer, { content: "* $oo \n* $aa" });
		expect(baseElement.querySelectorAll(".katex")).toHaveLength(0);
	});
	it.todo("renders latex with some < and > symbols", () => {
		const { baseElement } = render(MarkdownRenderer, { content: "$foo < bar > baz$" });
		expect(baseElement.querySelectorAll(".katex")).toHaveLength(1);
	});
});
