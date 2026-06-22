import { describe, expect, it } from "vitest";
import { buildDeployableHtml, isDeployableKind } from "$lib/utils/previewSrcdoc";

describe("buildDeployableHtml", () => {
	it("flags only self-contained kinds as deployable", () => {
		expect(isDeployableKind("html")).toBe(true);
		expect(isDeployableKind("svg")).toBe(true);
		expect(isDeployableKind("react")).toBe(true);
		expect(isDeployableKind("mermaid")).toBe(true);
		expect(isDeployableKind("code")).toBe(false);
		expect(isDeployableKind("markdown")).toBe(false);
	});

	it("ships raw HTML verbatim (no base tag or preview hook injected)", () => {
		const html = `<!doctype html><html><head><title>App</title></head><body><a href="/page">x</a></body></html>`;
		const out = buildDeployableHtml("html", html);
		expect(out).toBe(html);
		expect(out).not.toContain("base target");
	});

	// The deployed page has no parent window, so the postMessage hook (which the
	// preview builders inject) must never ship to a Space.
	it("never embeds the preview postMessage hook", () => {
		const kinds = [
			["svg", "<svg xmlns='http://www.w3.org/2000/svg'><rect width='10' height='10'/></svg>"],
			["react", "export default function App(){ return <div>hi</div>; }"],
			["mermaid", "graph TD; A-->B;"],
		] as const;
		for (const [kind, content] of kinds) {
			const out = buildDeployableHtml(kind, content);
			expect(out, kind).not.toContain("parent.postMessage");
			expect(out, kind).not.toContain("chatui.preview");
		}
	});

	it("wraps React with the React + Babel CDNs and embeds the source", () => {
		const out = buildDeployableHtml(
			"react",
			"export default function App(){ return <div>hi</div>; }"
		);
		expect(out).toContain("unpkg.com/react@18");
		expect(out).toContain("@babel/standalone");
		expect(out).toContain("artifact-root");
	});

	it("wraps Mermaid with the Mermaid CDN", () => {
		const out = buildDeployableHtml("mermaid", "graph TD; A-->B;");
		expect(out).toContain("mermaid@11");
		expect(out).toContain("graph TD");
	});

	it("wraps bare SVG into a full HTML document", () => {
		const svg = "<svg xmlns='http://www.w3.org/2000/svg'><rect width='10' height='10'/></svg>";
		const out = buildDeployableHtml("svg", svg);
		expect(out).toContain("<!doctype html>");
		expect(out).toContain("<svg");
	});
});
