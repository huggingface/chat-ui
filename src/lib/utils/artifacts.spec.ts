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

	it("marks the streaming version", () => {
		const registry = collectArtifacts([
			msg("m1", `<artifact identifier="app" type="html" title="App">stream`),
		]);
		expect(registry.streaming).toEqual({ identifier: "app", version: 1 });
		expect(registry.artifacts.get("app")?.versions[0].complete).toBe(false);
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

	it("applies streaming update pairs progressively", () => {
		const registry = collectArtifacts([
			msg("m1", `<artifact identifier="app" type="html" title="App">alpha beta</artifact>`),
			msg(
				"m2",
				`<artifact identifier="app" type="update"><old_str>alpha</old_str><new_str>gamma</new_str><old_str>be`
			),
		]);
		const version = registry.artifacts.get("app")?.versions[1];
		expect(version?.content).toBe("gamma beta");
		expect(version?.complete).toBe(false);
		expect(registry.streaming).toEqual({ identifier: "app", version: 2 });
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
