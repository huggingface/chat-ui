import { describe, expect, it } from "vitest";
import {
	applyArtifactUpdate,
	artifactFileName,
	collectArtifacts,
	normalizeArtifactKind,
	splitArtifactSegments,
	stripArtifacts,
} from "./artifacts";

const HTML_ARTIFACT = `<artifact identifier="snake-game" type="html" title="Snake Game">
<!doctype html>
<html><body>snake</body></html>
</artifact>`;

describe("splitArtifactSegments", () => {
	it("returns plain text untouched", () => {
		expect(splitArtifactSegments("hello world")).toEqual([
			{ type: "text", content: "hello world" },
		]);
	});

	it("extracts a complete artifact with surrounding text", () => {
		const segments = splitArtifactSegments(`Here you go:\n\n${HTML_ARTIFACT}\n\nEnjoy!`);
		expect(segments).toHaveLength(3);
		expect(segments[0]).toEqual({ type: "text", content: "Here you go:\n\n" });
		const artifact = segments[1];
		if (artifact.type !== "artifact" || artifact.op.kind !== "create") {
			throw new Error("expected create artifact");
		}
		expect(artifact.op.identifier).toBe("snake-game");
		expect(artifact.op.type).toBe("html");
		expect(artifact.op.title).toBe("Snake Game");
		expect(artifact.op.closed).toBe(true);
		expect(artifact.op.content).toBe("<!doctype html>\n<html><body>snake</body></html>");
		expect(segments[2]).toEqual({ type: "text", content: "\n\nEnjoy!" });
	});

	it("parses attributes regardless of order and normalizes MIME types", () => {
		const segments = splitArtifactSegments(
			`<artifact title="T" type="application/vnd.ant.react" identifier="widget">code</artifact>`
		);
		const artifact = segments[0];
		if (artifact.type !== "artifact" || artifact.op.kind !== "create") {
			throw new Error("expected create artifact");
		}
		expect(artifact.op.identifier).toBe("widget");
		expect(artifact.op.type).toBe("react");
	});

	it("keeps an unterminated artifact open while streaming", () => {
		const segments = splitArtifactSegments(
			`Intro <artifact identifier="doc" type="markdown" title="Doc">\n# Heading\nbody text`
		);
		expect(segments[0]).toEqual({ type: "text", content: "Intro " });
		const artifact = segments[1];
		if (artifact.type !== "artifact" || artifact.op.kind !== "create") {
			throw new Error("expected create artifact");
		}
		expect(artifact.op.closed).toBe(false);
		expect(artifact.op.content).toBe("# Heading\nbody text");
	});

	it("hides a partially streamed opening tag", () => {
		const segments = splitArtifactSegments(`Sure thing!\n<artifact identifier="ga`);
		expect(segments).toEqual([{ type: "text", content: "Sure thing!\n" }]);
	});

	it("hides a partially streamed tag name", () => {
		expect(splitArtifactSegments("Sure thing!\n<artifa")).toEqual([
			{ type: "text", content: "Sure thing!\n" },
		]);
	});

	it("trims a partially streamed closing tag from open content", () => {
		const segments = splitArtifactSegments(
			`<artifact identifier="x" type="html" title="X">content</artifa`
		);
		const artifact = segments[0];
		if (artifact.type !== "artifact" || artifact.op.kind !== "create") {
			throw new Error("expected create artifact");
		}
		expect(artifact.op.closed).toBe(false);
		expect(artifact.op.content).toBe("content");
	});

	it("parses update operations with multiple pairs", () => {
		const segments = splitArtifactSegments(
			`<artifact identifier="snake-game" type="update" title="Faster snake">
<old_str>const SPEED = 200;</old_str>
<new_str>const SPEED = 120;</new_str>
<old_str>scoreboard</old_str>
<new_str>score board</new_str>
</artifact>`
		);
		const artifact = segments[0];
		if (artifact.type !== "artifact" || artifact.op.kind !== "update") {
			throw new Error("expected update artifact");
		}
		expect(artifact.op.identifier).toBe("snake-game");
		expect(artifact.op.title).toBe("Faster snake");
		expect(artifact.op.pairs).toEqual([
			{ old: "const SPEED = 200;", new: "const SPEED = 120;" },
			{ old: "scoreboard", new: "score board" },
		]);
		expect(artifact.op.closed).toBe(true);
	});

	it("only yields complete pairs while an update streams", () => {
		const segments = splitArtifactSegments(
			`<artifact identifier="snake-game" type="update">
<old_str>a</old_str>
<new_str>b</new_str>
<old_str>partial`
		);
		const artifact = segments[0];
		if (artifact.type !== "artifact" || artifact.op.kind !== "update") {
			throw new Error("expected update artifact");
		}
		expect(artifact.op.pairs).toEqual([{ old: "a", new: "b" }]);
		expect(artifact.op.closed).toBe(false);
	});

	it("handles multiple artifacts in one message", () => {
		const segments = splitArtifactSegments(`${HTML_ARTIFACT}\nand\n${HTML_ARTIFACT}`);
		const kinds = segments.map((s) => s.type);
		expect(kinds).toEqual(["artifact", "text", "artifact"]);
	});
});

describe("applyArtifactUpdate", () => {
	it("replaces the first occurrence of each pair", () => {
		const result = applyArtifactUpdate("aaa bbb aaa", [{ old: "aaa", new: "xxx" }]);
		expect(result).toEqual({ content: "xxx bbb aaa", applied: 1, failed: 0 });
	});

	it("skips pairs that do not match without voiding the rest", () => {
		const result = applyArtifactUpdate("hello world", [
			{ old: "nope", new: "x" },
			{ old: "world", new: "there" },
		]);
		expect(result).toEqual({ content: "hello there", applied: 1, failed: 1 });
	});

	it("applies pairs sequentially so later pairs can match earlier output", () => {
		const result = applyArtifactUpdate("v1", [
			{ old: "v1", new: "v2" },
			{ old: "v2", new: "v3" },
		]);
		expect(result.content).toBe("v3");
	});

	it("matches across smart quotes in content, preserving surrounding text", () => {
		// content has curly double quotes; old_str uses straight quotes
		const content = `const greeting = “Hello”; // tag`;
		const result = applyArtifactUpdate(content, [{ old: `"Hello"`, new: `"Goodbye"` }]);
		expect(result).toMatchObject({ applied: 1, failed: 0 });
		expect(result.content).toBe(`const greeting = "Goodbye"; // tag`);
	});

	it("matches when old_str uses smart quotes and content is straight", () => {
		const result = applyArtifactUpdate(`x = "v"`, [{ old: `x = “v”`, new: `x = "w"` }]);
		expect(result).toMatchObject({ applied: 1, failed: 0, content: `x = "w"` });
	});

	it("matches an em-dash in content against a hyphen in old_str", () => {
		const result = applyArtifactUpdate(`a — b`, [{ old: `a - b`, new: `a + b` }]);
		expect(result).toMatchObject({ applied: 1, failed: 0, content: `a + b` });
	});

	it("matches an NBSP in content against a normal space (whitespace tolerance)", () => {
		const nbsp = String.fromCharCode(0xa0);
		const result = applyArtifactUpdate(`foo${nbsp}bar`, [{ old: `foo bar`, new: `foo baz` }]);
		expect(result).toMatchObject({ applied: 1, failed: 0, content: `foo baz` });
	});
});

describe("collectArtifacts", () => {
	const msg = (id: string, content: string, from: "user" | "assistant" = "assistant") => ({
		id,
		from,
		content,
	});

	it("folds create + update into versions", () => {
		const registry = collectArtifacts([
			msg("m1", `<artifact identifier="app" type="html" title="App">v1 content</artifact>`),
			msg("m2", "make it faster", "user"),
			msg(
				"m3",
				`Done! <artifact identifier="app" type="update" title="App v2"><old_str>v1</old_str><new_str>v2</new_str></artifact>`
			),
		]);
		const artifact = registry.artifacts.get("app");
		expect(artifact).toBeDefined();
		expect(artifact?.versions).toHaveLength(2);
		expect(artifact?.versions[0]).toMatchObject({
			op: "create",
			version: 1,
			content: "v1 content",
			complete: true,
		});
		expect(artifact?.versions[1]).toMatchObject({
			op: "update",
			version: 2,
			content: "v2 content",
			title: "App v2",
			type: "html",
			failedPairs: 0,
		});
		expect(registry.byMessageOp.get("m1:0")).toEqual({ identifier: "app", version: 1 });
		expect(registry.byMessageOp.get("m3:0")).toEqual({ identifier: "app", version: 2 });
		expect(registry.streaming).toBeUndefined();
	});

	it("treats re-emitting a known identifier as a rewrite", () => {
		const registry = collectArtifacts([
			msg("m1", `<artifact identifier="app" type="html" title="App">one</artifact>`),
			msg("m2", `<artifact identifier="app" type="html" title="App">two</artifact>`),
		]);
		expect(registry.artifacts.get("app")?.versions[1]).toMatchObject({
			op: "rewrite",
			version: 2,
			content: "two",
		});
	});

	it("marks the streaming version while its message is live", () => {
		const registry = collectArtifacts(
			[msg("m1", `<artifact identifier="app" type="html" title="App">stream`)],
			"m1"
		);
		expect(registry.streaming).toEqual({ identifier: "app", version: 1 });
		expect(registry.artifacts.get("app")?.versions[0].complete).toBe(false);
	});

	it("finalizes an unclosed artifact whose message is no longer generating", () => {
		// Aborted/interrupted generations leave the tag unterminated forever; the
		// version must not read as streaming once nothing can append to it.
		const registry = collectArtifacts([
			msg("m1", `<artifact identifier="app" type="html" title="App">stream`),
		]);
		expect(registry.streaming).toBeUndefined();
		expect(registry.artifacts.get("app")?.versions[0]).toMatchObject({
			complete: true,
			interrupted: true,
			content: "stream",
		});
	});

	it("finalizes an unclosed artifact in an earlier message even while another is live", () => {
		const registry = collectArtifacts(
			[
				msg("m1", `<artifact identifier="app" type="html" title="App">partial`),
				msg("m2", "continue", "user"),
				msg("m3", `<artifact identifier="app" type="html" title="App">fresh`),
			],
			"m3"
		);
		expect(registry.artifacts.get("app")?.versions[0]).toMatchObject({
			complete: true,
			interrupted: true,
		});
		expect(registry.artifacts.get("app")?.versions[1].complete).toBe(false);
		expect(registry.streaming).toEqual({ identifier: "app", version: 2 });
	});

	it("flags updates that reference unknown artifacts", () => {
		const registry = collectArtifacts([
			msg(
				"m1",
				`<artifact identifier="ghost" type="update"><old_str>a</old_str><new_str>b</new_str></artifact>`
			),
		]);
		expect(registry.artifacts.size).toBe(0);
		expect(registry.byMessageOp.get("m1:0")).toEqual({ identifier: "ghost", version: -1 });
	});

	it("links a renamed-identifier update to the existing artifact", () => {
		const registry = collectArtifacts([
			msg(
				"m1",
				`<artifact identifier="green-button" type="html" title="Green Button">a green btn</artifact>`
			),
			msg(
				"m2",
				`<artifact identifier="blue-button" type="update" title="Blue Button"><old_str>green</old_str><new_str>blue</new_str></artifact>`
			),
		]);
		// The update linked to the existing artifact instead of orphaning into a dead card
		expect(registry.artifacts.size).toBe(1);
		const versions = registry.artifacts.get("green-button")?.versions;
		expect(versions).toHaveLength(2);
		expect(versions?.[1]).toMatchObject({
			identifier: "green-button",
			op: "update",
			title: "Blue Button",
			content: "a blue btn",
		});
		expect(registry.byMessageOp.get("m2:0")).toEqual({ identifier: "green-button", version: 2 });
	});

	it("links a case-drifted identifier update to the existing artifact", () => {
		const registry = collectArtifacts([
			msg("m1", `<artifact identifier="app" type="html" title="App">alpha beta</artifact>`),
			msg(
				"m2",
				`<artifact identifier="App" type="update"><old_str>alpha</old_str><new_str>gamma</new_str></artifact>`
			),
		]);
		expect(registry.artifacts.size).toBe(1);
		expect(registry.artifacts.get("app")?.versions).toHaveLength(2);
		expect(registry.artifacts.get("app")?.versions[1]?.content).toBe("gamma beta");
	});

	it("links an orphan update to the most-recently-created artifact when several exist", () => {
		const registry = collectArtifacts([
			msg("m1", `<artifact identifier="first" type="html" title="First">one</artifact>`),
			msg("m2", `<artifact identifier="second" type="html" title="Second">two</artifact>`),
			msg(
				"m3",
				`<artifact identifier="ghost" type="update"><old_str>two</old_str><new_str>three</new_str></artifact>`
			),
		]);
		// No "ghost" artifact created; the update attached to the most recent ("second")
		expect(registry.artifacts.has("ghost")).toBe(false);
		expect(registry.artifacts.get("first")?.versions).toHaveLength(1);
		expect(registry.artifacts.get("second")?.versions).toHaveLength(2);
		expect(registry.artifacts.get("second")?.versions[1]?.content).toBe("three");
		expect(registry.byMessageOp.get("m3:0")).toEqual({ identifier: "second", version: 2 });
	});

	it("applies streaming update pairs progressively", () => {
		const registry = collectArtifacts(
			[
				msg("m1", `<artifact identifier="app" type="html" title="App">alpha beta</artifact>`),
				msg(
					"m2",
					`<artifact identifier="app" type="update"><old_str>alpha</old_str><new_str>gamma</new_str><old_str>be`
				),
			],
			"m2"
		);
		const version = registry.artifacts.get("app")?.versions[1];
		expect(version?.content).toBe("gamma beta");
		expect(version?.complete).toBe(false);
		expect(registry.streaming).toEqual({ identifier: "app", version: 2 });
	});

	it("finalizes an interrupted update op", () => {
		const registry = collectArtifacts([
			msg("m1", `<artifact identifier="app" type="html" title="App">alpha beta</artifact>`),
			msg(
				"m2",
				`<artifact identifier="app" type="update"><old_str>alpha</old_str><new_str>gamma</new_str><old_str>be`
			),
		]);
		const version = registry.artifacts.get("app")?.versions[1];
		expect(version?.content).toBe("gamma beta");
		expect(version).toMatchObject({ complete: true, interrupted: true });
		expect(registry.streaming).toBeUndefined();
	});

	it("ignores artifacts in user messages", () => {
		const registry = collectArtifacts([
			msg("m1", `<artifact identifier="app" type="html" title="App">x</artifact>`, "user"),
		]);
		expect(registry.artifacts.size).toBe(0);
	});
});

describe("stripArtifacts", () => {
	it("removes artifact blocks but keeps prose", () => {
		expect(stripArtifacts(`Here you go:\n\n${HTML_ARTIFACT}\n\nEnjoy!`)).toBe(
			"Here you go:\n\nEnjoy!"
		);
	});
});

describe("misc helpers", () => {
	it("normalizes kinds with fallback to code", () => {
		expect(normalizeArtifactKind("text/html")).toBe("html");
		expect(normalizeArtifactKind("REACT")).toBe("react");
		expect(normalizeArtifactKind("something-else")).toBe("code");
		expect(normalizeArtifactKind(undefined)).toBe("code");
	});

	it("picks sensible file extensions", () => {
		const base = {
			identifier: "my-app",
			title: "t",
			content: "",
			complete: true,
			op: "create" as const,
			version: 1,
			messageId: "m",
		};
		expect(artifactFileName({ ...base, type: "html" })).toBe("my-app.html");
		expect(artifactFileName({ ...base, type: "code", language: "python" })).toBe("my-app.py");
		expect(artifactFileName({ ...base, type: "code", language: "weird" })).toBe("my-app.txt");
		expect(artifactFileName({ ...base, type: "mermaid" })).toBe("my-app.mmd");
	});
});

// Regression: Kimi-K2.6 (and others) sometimes double the opening bracket of
// every tag they were taught: `<<artifact …>`, `<<old_str>`. The parser must
// consume the whole bracket run (no stray `<` in prose) and still pair up
// old/new strings. Seen live in HuggingChat conversation 6a286d5e.
describe("doubled-bracket tolerance", () => {
	it("parses <<artifact create blocks without leaking a stray <", () => {
		const segments = splitArtifactSegments(
			`</think><<artifact identifier="blue-button" type="html" title="Blue Button">\n<!DOCTYPE html>\n<button>Click Me</button>\n</artifact>`
		);
		expect(segments[0]).toEqual({ type: "text", content: "</think>" });
		const artifact = segments[1];
		if (artifact.type !== "artifact" || artifact.op.kind !== "create") {
			throw new Error("expected create artifact");
		}
		expect(artifact.op.identifier).toBe("blue-button");
		expect(artifact.op.content).toBe("<!DOCTYPE html>\n<button>Click Me</button>");
	});

	it("parses <<old_str>/<<new_str> pairs and doubled closing tags", () => {
		const segments = splitArtifactSegments(
			`<<artifact identifier="blue-button" type="update" title="Green Button">
<<old_str>      background: #2563eb;</old_str>
<<new_str>      background: #16a34a;<</new_str>
<</artifact>`
		);
		const artifact = segments[0];
		if (artifact.type !== "artifact" || artifact.op.kind !== "update") {
			throw new Error("expected update artifact");
		}
		expect(artifact.op.closed).toBe(true);
		expect(artifact.op.pairs).toEqual([
			{ old: "      background: #2563eb;", new: "      background: #16a34a;" },
		]);
	});

	it("applies the green-button edit end to end (three <<-mangled update blocks)", () => {
		const v1 = `<artifact identifier="blue-button" type="html" title="Blue Button">
<style>
      background: #2563eb;
      box-shadow: 0 4px 6px -1px rgba(37, 99, 235, 0.3);
      background: #1d4ed8;
</style>
</artifact>`;
		const updates = `<<artifact identifier="blue-button" type="update" title="Green Button">
<<old_str>      background: #2563eb;</old_str>
<<new_str>      background: #16a34a;</new_str>
</artifact>

<<artifact identifier="blue-button" type="update" title="Green Button">
<<old_str>      box-shadow: 0 4px 6px -1px rgba(37, 99, 235, 0.3);</old_str>
<<new_str>      box-shadow: 0 4px 6px -1px rgba(22, 163, 74, 0.3);</new_str>
</artifact>

<<artifact identifier="blue-button" type="update" title="Green Button">
<<old_str>      background: #1d4ed8;</old_str>
<<new_str>      background: #15803d;</new_str>
</artifact>`;
		const registry = collectArtifacts([
			{ id: "m1", from: "assistant", content: v1 },
			{ id: "m2", from: "user", content: "make it green" },
			{ id: "m3", from: "assistant", content: updates },
		]);
		const versions = registry.artifacts.get("blue-button")?.versions ?? [];
		expect(versions).toHaveLength(4);
		expect(versions[3].content).toContain("background: #16a34a;");
		expect(versions[3].content).toContain("rgba(22, 163, 74, 0.3)");
		expect(versions[3].content).toContain("background: #15803d;");
		expect(versions[3].content).not.toContain("#2563eb");
		expect(versions.every((v) => !v.failedPairs)).toBe(true);
	});

	it("hides a partially streamed doubled opening tag", () => {
		expect(splitArtifactSegments("Sure!\n<<artifa")).toEqual([
			{ type: "text", content: "Sure!\n" },
		]);
	});

	it("collapses a doubled bracket on the content's leading tag (<<svg)", () => {
		const segments = splitArtifactSegments(
			`<<artifact identifier="balloon" type="svg" title="Balloon">\n<<svg viewBox="0 0 800 600"><circle r="5"/></svg>\n</artifact>`
		);
		const artifact = segments[0];
		if (artifact.type !== "artifact" || artifact.op.kind !== "create") {
			throw new Error("expected create artifact");
		}
		expect(artifact.op.content).toBe(`<svg viewBox="0 0 800 600"><circle r="5"/></svg>`);
	});

	it("matches old_str quoting raw <<-mangled output against normalized content", () => {
		const result = applyArtifactUpdate(`<svg viewBox="0 0 10 10">\n  <circle r="5"/>\n</svg>`, [
			{ old: `<<svg viewBox="0 0 10 10">`, new: `<svg viewBox="0 0 20 20">` },
		]);
		expect(result.applied).toBe(1);
		expect(result.failed).toBe(0);
		expect(result.content).toContain(`viewBox="0 0 20 20"`);
	});
});

describe("zero-pair updates are flagged", () => {
	it("marks a closed update with no parseable pairs as a failed edit", () => {
		const registry = collectArtifacts([
			{
				id: "m1",
				from: "assistant",
				content: `<artifact identifier="app" type="html" title="App">hello</artifact>`,
			},
			{
				id: "m2",
				from: "assistant",
				content: `<artifact identifier="app" type="update">garbage without pairs</artifact>`,
			},
		]);
		const v2 = registry.artifacts.get("app")?.versions[1];
		expect(v2?.content).toBe("hello");
		expect(v2?.failedPairs).toBe(1);
	});

	it("does not flag a still-streaming update with no pairs yet", () => {
		const registry = collectArtifacts(
			[
				{
					id: "m1",
					from: "assistant",
					content: `<artifact identifier="app" type="html" title="App">hello</artifact>`,
				},
				{
					id: "m2",
					from: "assistant",
					content: `<artifact identifier="app" type="update">\n<old_str>hel`,
				},
			],
			"m2"
		);
		const v2 = registry.artifacts.get("app")?.versions[1];
		expect(v2?.complete).toBe(false);
		expect(v2?.failedPairs).toBe(0);
	});
});

describe("whitespace-tolerant matching", () => {
	it("applies a pair whose old_str has wrong indentation", () => {
		const base = `<div class="timer-content">\n                <div class="timer-label">Ready to focus</div>\n            </div>`;
		const result = applyArtifactUpdate(base, [
			{
				old: `    <div class="timer-label">Ready to focus</div>`,
				new: `    <div class="timer-label">LET'S GO</div>`,
			},
		]);
		expect(result.applied).toBe(1);
		expect(result.failed).toBe(0);
		expect(result.content).toContain("LET'S GO");
		expect(result.content).not.toContain("Ready to focus");
	});

	it("tolerates newline drift inside the needle", () => {
		const base = `a { color: red;\n  font-weight: bold; }`;
		const result = applyArtifactUpdate(base, [
			{ old: `color: red; font-weight: bold;`, new: `color: blue;` },
		]);
		expect(result.applied).toBe(1);
		expect(result.content).toBe(`a { color: blue; }`);
	});

	it("still fails when the text genuinely is not there", () => {
		const result = applyArtifactUpdate("hello world", [{ old: "goodbye", new: "x" }]);
		expect(result).toEqual({ content: "hello world", applied: 0, failed: 1 });
	});

	it("prefers the exact match over a fuzzy one", () => {
		const base = "x  y\nx y";
		const result = applyArtifactUpdate(base, [{ old: "x y", new: "Z" }]);
		expect(result.content).toBe("x  y\nZ");
	});
});

describe("think blocks are ignored by the registry", () => {
	it("does not create versions from artifact tags rehearsed inside <think>", () => {
		const registry = collectArtifacts([
			{
				id: "m1",
				from: "assistant",
				content: `<think>I'll draft it first: <artifact identifier="app" type="html" title="Draft">draft</artifact> ok now for real.</think><artifact identifier="app" type="html" title="App">real content</artifact>`,
			},
		]);
		const artifact = registry.artifacts.get("app");
		expect(artifact?.versions).toHaveLength(1);
		expect(artifact?.versions[0].content).toBe("real content");
		expect(registry.byMessageOp.get("m1:0")).toEqual({ identifier: "app", version: 1 });
	});

	it("ignores old_str/new_str rehearsed in an unclosed streaming think block", () => {
		const registry = collectArtifacts([
			{
				id: "m1",
				from: "assistant",
				content: `<artifact identifier="app" type="html" title="App">v1</artifact>`,
			},
			{
				id: "m2",
				from: "assistant",
				content: `<think>maybe <artifact identifier="app" type="update"><old_str>v1</old_str><new_str>v2</new_str></artifact> hmm still thinking`,
			},
		]);
		expect(registry.artifacts.get("app")?.versions).toHaveLength(1);
		expect(registry.streaming).toBeUndefined();
	});
});
