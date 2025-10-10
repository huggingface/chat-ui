import MarkdownRenderer from "./MarkdownRenderer.svelte";
import { render } from "vitest-browser-svelte";
import { page } from "@vitest/browser/context";

import { describe, expect, it } from "vitest";

describe("MarkdownRenderer", () => {
	it("renders", () => {
		render(MarkdownRenderer, { content: "Hello, world!" });
		expect(page.getByText("Hello, world!")).toBeInTheDocument();
	});
	it("renders headings", () => {
		render(MarkdownRenderer, { content: "# Hello, world!" });
		expect(page.getByRole("heading", { level: 1 })).toBeInTheDocument();
	});
	it("renders links", () => {
		render(MarkdownRenderer, { content: "[Hello, world!](https://example.com)" });
		const link = page.getByRole("link", { name: "Hello, world!" });
		expect(link).toBeInTheDocument();
		expect(link).toHaveAttribute("href", "https://example.com");
		expect(link).toHaveAttribute("target", "_blank");
		expect(link).toHaveAttribute("rel", "noreferrer");
	});
	it("renders inline codespans", () => {
		render(MarkdownRenderer, { content: "`foobar`" });
		expect(page.getByRole("code")).toHaveTextContent("foobar");
	});
	it("renders block codes", () => {
		render(MarkdownRenderer, { content: "```foobar```" });
		expect(page.getByRole("code")).toHaveTextContent("foobar");
	});
	it("renders raw bracket citations without turning them into links when no sources provided", () => {
		render(MarkdownRenderer, { content: "Hello there [1]" });
		expect(page.getByText("[1]")).toBeInTheDocument();
		// No link should be created from the bracket citation
		expect(page.getByRole("link", { name: "1" }).elements).toHaveLength(0);
	});
	it("linkifies bracket citations when matching sources are provided", () => {
		render(MarkdownRenderer, {
			content: "Hello there [1] and also [2]",
			sources: [
				{ index: 1, link: "https://example.com" },
				{ index: 2, link: "https://example.org" },
			],
		});
		const link1 = page.getByRole("link", { name: "1" });
		const link2 = page.getByRole("link", { name: "2" });
		expect(link1).toBeInTheDocument();
		expect(link1).toHaveAttribute("href", "https://example.com");
		expect(link2).toBeInTheDocument();
		expect(link2).toHaveAttribute("href", "https://example.org");
	});
	it("doesnt render raw html directly", () => {
		render(MarkdownRenderer, { content: "<button>Click me</button>" });
		expect(page.getByRole("button").elements).toHaveLength(0);
		expect(page.getByRole("paragraph")).toHaveTextContent("<button>Click me</button>");
	});
	it("renders latex", () => {
		const { baseElement } = render(MarkdownRenderer, { content: "$(oo)^2$" });
		expect(baseElement.querySelectorAll(".katex")).toHaveLength(1);
	});
	it("does not render latex in code blocks", () => {
		const { baseElement } = render(MarkdownRenderer, { content: "```\n$(oo)^2$\n```" });
		expect(baseElement.querySelectorAll(".katex")).toHaveLength(0);
	});
	it("does not render latex in inline codes", () => {
		const { baseElement } = render(MarkdownRenderer, { content: "`$oo` and `$bar`" });
		expect(baseElement.querySelectorAll(".katex")).toHaveLength(0);
	});
	it("does not render latex across multiple lines", () => {
		const { baseElement } = render(MarkdownRenderer, { content: "* $oo \n* $aa" });
		expect(baseElement.querySelectorAll(".katex")).toHaveLength(0);
	});
	it("renders latex with some < and > symbols", () => {
		const { baseElement } = render(MarkdownRenderer, { content: "$foo < bar > baz$" });
		expect(baseElement.querySelectorAll(".katex")).toHaveLength(1);
	});
});
