import { describe, expect, it } from "vitest";
import {
	buildArtifactSrcdoc,
	buildDeployableHtml,
	isDeployableKind,
} from "$lib/utils/previewSrcdoc";
import { BADGE_HOST_ATTRIBUTE } from "$lib/utils/deployBadge";

/** Drop the injected badge script so the rest of the document can be compared. */
function stripBadge(html: string): string {
	return html.replace(/\n<script data-huggingchat-badge[\s\S]*?<\/script>\n/, "");
}

describe("buildDeployableHtml", () => {
	it("flags only self-contained kinds as deployable", () => {
		expect(isDeployableKind("html")).toBe(true);
		expect(isDeployableKind("svg")).toBe(true);
		expect(isDeployableKind("react")).toBe(true);
		expect(isDeployableKind("mermaid")).toBe(true);
		expect(isDeployableKind("code")).toBe(false);
		expect(isDeployableKind("markdown")).toBe(false);
	});

	it("ships raw HTML untouched apart from the badge (no base tag or preview hook)", () => {
		const html = `<!doctype html><html><head><title>App</title></head><body><a href="/page">x</a></body></html>`;
		const out = buildDeployableHtml("html", html);
		expect(out).not.toContain("base target");
		expect(stripBadge(out)).toBe(html);
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

describe("HuggingChat badge", () => {
	const kinds = [
		["html", "<!doctype html><html><body><p>hi</p></body></html>"],
		["svg", "<svg xmlns='http://www.w3.org/2000/svg'><rect width='10' height='10'/></svg>"],
		["react", "export default function App(){ return <div>hi</div>; }"],
		["mermaid", "graph TD; A-->B;"],
	] as const;

	it("is injected into every deployed kind, inside a closed shadow root", () => {
		for (const [kind, content] of kinds) {
			const out = buildDeployableHtml(kind, content);
			expect(out, kind).toContain(BADGE_HOST_ATTRIBUTE);
			expect(out, kind).toContain("Made with HuggingChat");
			expect(out, kind).toContain("https://huggingface.co/chat");
			expect(out, kind).toContain('mode: "closed"');
		}
	});

	it("is never injected into previews", () => {
		for (const [kind, content] of kinds) {
			expect(buildArtifactSrcdoc(kind, content, "chan"), kind).not.toContain(BADGE_HOST_ATTRIBUTE);
		}
	});

	it("goes just before the last closing body tag", () => {
		const out = buildDeployableHtml(
			"html",
			"<!doctype html><html><body><pre>&lt;/body&gt;</pre></body></html>"
		);
		expect(out.indexOf(BADGE_HOST_ATTRIBUTE)).toBeLessThan(out.lastIndexOf("</body>"));
		expect(out.trimEnd().endsWith("</html>")).toBe(true);
	});

	it("appends at the end when the document has no body tag", () => {
		const out = buildDeployableHtml("html", "<p>fragment only</p>");
		expect(out.startsWith("<p>fragment only</p>")).toBe(true);
		expect(out).toContain(BADGE_HOST_ATTRIBUTE);
	});

	it("cannot be terminated early by artifact content", () => {
		const out = buildDeployableHtml("html", "<body></body>");
		// The badge script must contain no raw `</script` other than its own terminator.
		const script = out.slice(out.indexOf("<script data-huggingchat-badge"));
		expect(script.match(/<\/script/gi)).toHaveLength(1);
	});
});
