import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("$lib/server/config", () => ({ config: { GITHUB_TOKEN: "ghp_test_token" } }));

import { resetGithubCache } from "./client";
import {
	MAX_WINDOW_CHARS,
	MAX_WINDOW_LINES,
	readFile,
	resolveWindow,
	splitLines,
} from "./readFile";
import { installGithubFetch, type GithubFetchMock, type Responder } from "./__fixtures__/mockFetch";

const CONTENTS = "/repos/huggingface/trl/contents/examples/scripts/sft.py";

const base64 = (text: string) => Buffer.from(text, "utf8").toString("base64");

/** GitHub wraps base64 at 60 characters; a decoder that forgets to strip newlines fails here. */
const wrapped = (text: string) => (base64(text).match(/.{1,60}/g) ?? []).join("\n");

let mock: GithubFetchMock | undefined;
const install = (responder: Responder) => {
	mock = installGithubFetch(responder);
	return mock;
};

const fileOf = (text: string, extra: Record<string, unknown> = {}) => ({
	type: "file",
	encoding: "base64",
	size: text.length,
	content: wrapped(text),
	...extra,
});

const serveFile = (text: string, path = CONTENTS): Responder => {
	return ({ path: requested }) =>
		requested.split("?")[0] === path ? { json: fileOf(text) } : undefined;
};

const lines = (count: number, prefix = "line") =>
	Array.from({ length: count }, (_, i) => `${prefix} ${i + 1}`).join("\n");

beforeEach(() => resetGithubCache());
afterEach(() => {
	mock?.restore();
	mock = undefined;
});

describe("splitLines", () => {
	it("does not invent a trailing line for a file that ends in a newline", () => {
		// The Python original counted a 300-line file as 301 and tripped its own cap.
		expect(splitLines("a\nb\nc\n")).toEqual(["a", "b", "c"]);
		expect(splitLines("a\nb\nc")).toEqual(["a", "b", "c"]);
		expect(splitLines("")).toEqual([""]);
	});
});

describe("resolveWindow", () => {
	const body = Array.from({ length: 812 }, (_, i) => `l${i}`);

	it("caps an unbounded read at the default window", () => {
		expect(resolveWindow(body, undefined, undefined)).toEqual({
			ok: true,
			window: { start: 1, end: 300 },
		});
	});

	it("returns a short file whole", () => {
		expect(resolveWindow(body.slice(0, 42), undefined, undefined)).toEqual({
			ok: true,
			window: { start: 1, end: 42 },
		});
	});

	it("clamps an end past EOF rather than refusing it", () => {
		expect(resolveWindow(body, 800, 99999)).toEqual({ ok: true, window: { start: 800, end: 812 } });
	});

	it("runs an open-ended explicit start to EOF, not to the default window", () => {
		expect(resolveWindow(body.slice(0, 400), 350, undefined)).toEqual({
			ok: true,
			window: { start: 350, end: 400 },
		});
	});

	it("errors on a backwards range", () => {
		const result = resolveWindow(body, 500, 100);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.message).toContain("runs forwards");
	});

	it("errors on a start past the end of the file", () => {
		const result = resolveWindow(body, 9000, undefined);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.message).toContain("812 lines");
	});

	it("caps an oversized explicit range at the tool boundary", () => {
		// Better an honest cap here than a silent amputation by whatever trims the
		// context later, which would leave the model believing it read the whole file.
		const huge = Array.from({ length: 20_000 }, (_, i) => `l${i}`);
		const result = resolveWindow(huge, 1, 20_000);
		expect(result).toEqual({
			ok: true,
			window: { start: 1, end: MAX_WINDOW_LINES, cappedBy: "lines" },
		});
	});

	it("caps on characters when the lines are long", () => {
		const fat = Array.from({ length: 500 }, () => "x".repeat(1000));
		const result = resolveWindow(fat, 1, 500);
		expect(result.ok && result.window.cappedBy).toBe("chars");
	});
});

describe("readFile", () => {
	it("returns the file fenced with a language tag", async () => {
		install(serveFile("import trl\nprint(trl.__version__)\n"));
		const result = await readFile({ repo: "huggingface/trl", path: "examples/scripts/sft.py" });

		expect(result.isError).toBe(false);
		expect(result.text).toContain("```python");
		expect(result.text).toContain("import trl");
		expect(result.text).toContain("Showing all 2 lines.");
	});

	it("caps an unbounded read at 300 lines and always states the total", async () => {
		install(serveFile(`${lines(812)}\n`));
		const result = await readFile({ repo: "trl", path: "examples/scripts/sft.py" });

		expect(result.text).toContain("Showing lines 1-300 of 812.");
		expect(result.text).toContain("line 300");
		expect(result.text).not.toContain("line 301");
	});

	it("states the total for an explicit range too", async () => {
		// The Python original reported the total only on the implicit window, so a model
		// that asked for 1-500 of an 812-line file never learned the other 312 existed.
		install(serveFile(`${lines(812)}\n`));
		const result = await readFile({
			repo: "trl",
			path: "examples/scripts/sft.py",
			line_start: 1,
			line_end: 500,
		});
		expect(result.text).toContain("Showing lines 1-500 of 812.");
	});

	it("does not trip the cap on a file of exactly 300 lines with a trailing newline", async () => {
		install(serveFile(`${lines(300)}\n`));
		const result = await readFile({ repo: "trl", path: "examples/scripts/sft.py" });
		expect(result.text).toContain("Showing all 300 lines.");
	});

	it("caps at 301 lines", async () => {
		install(serveFile(`${lines(301)}\n`));
		const result = await readFile({ repo: "trl", path: "examples/scripts/sft.py" });
		expect(result.text).toContain("Showing lines 1-300 of 301.");
	});

	it("errors on a backwards range", async () => {
		install(serveFile(lines(50)));
		const result = await readFile({
			repo: "trl",
			path: "examples/scripts/sft.py",
			line_start: 40,
			line_end: 10,
		});
		expect(result.isError).toBe(true);
	});

	it("sends no ref query for the default, and the same request as an explicit HEAD", async () => {
		const recorder = install(serveFile("x"));
		await readFile({ repo: "trl", path: "examples/scripts/sft.py" });
		resetGithubCache();
		await readFile({ repo: "trl", path: "examples/scripts/sft.py", ref: "HEAD" });

		expect(recorder.paths).toEqual([CONTENTS, CONTENTS]);
	});

	it("passes a real ref through as a query parameter", async () => {
		const recorder = install(({ path }) =>
			path.startsWith(CONTENTS) ? { json: fileOf("x") } : undefined
		);
		await readFile({ repo: "trl", path: "examples/scripts/sft.py", ref: "v0.12.0" });

		expect(recorder.paths[0]).toBe(`${CONTENTS}?ref=v0.12.0`);
	});

	it("names the ref in the header only when one was given", async () => {
		install(({ path }) => (path.startsWith(CONTENTS) ? { json: fileOf("x") } : undefined));
		const pinned = await readFile({
			repo: "trl",
			path: "examples/scripts/sft.py",
			ref: "v0.12.0",
		});
		expect(pinned.text).toContain("(ref: v0.12.0)");

		resetGithubCache();
		const floating = await readFile({ repo: "trl", path: "examples/scripts/sft.py" });
		expect(floating.text).not.toContain("ref:");
	});

	it("says a path is missing rather than reporting a bare 404", async () => {
		install(() => undefined);
		const result = await readFile({ repo: "trl", path: "examples/scripts/nope.py" });

		expect(result.isError).toBe(true);
		expect(result.text).toContain("File not found: examples/scripts/nope.py in huggingface/trl");
	});

	it("says a directory is a directory, and lists what is in it", async () => {
		// A common enough mistake to deserve its own message.
		install(({ path }) =>
			path.startsWith("/repos/huggingface/trl/contents/examples/scripts")
				? {
						json: [
							{ name: "sft.py", type: "file" },
							{ name: "dpo.py", type: "file" },
						],
					}
				: undefined
		);
		const result = await readFile({ repo: "trl", path: "examples/scripts" });

		expect(result.isError).toBe(true);
		expect(result.text).toContain("is a directory");
		expect(result.text).toContain("sft.py");
	});

	it("falls back to the raw media type when content comes back empty", async () => {
		// Over ~1MB the contents API returns an empty `content`; several HF notebooks
		// are past that line, so this is a normal path rather than an oddity.
		const recorder = install(({ path, headers }) => {
			if (!path.startsWith(CONTENTS)) return undefined;
			if (headers.accept === "application/vnd.github.raw") {
				return { text: "print('from raw')\n" };
			}
			return { json: { type: "file", encoding: "none", size: 2_000_000, content: "" } };
		});

		const result = await readFile({ repo: "trl", path: "examples/scripts/sft.py" });
		expect(result.text).toContain("from raw");
		expect(recorder.requests.map((r) => r.headers.accept)).toEqual([
			"application/vnd.github+json",
			"application/vnd.github.raw",
		]);
	});

	it("refuses a file far too large to be source", async () => {
		install(({ path }) =>
			path.startsWith(CONTENTS)
				? { json: { type: "file", encoding: "none", size: 60_000_000, content: "" } }
				: undefined
		);
		const result = await readFile({ repo: "trl", path: "examples/scripts/sft.py" });
		expect(result.isError).toBe(true);
		expect(result.text).toContain("too large");
	});

	it("survives binary content without throwing", async () => {
		const binary = Buffer.from([0xff, 0xfe, 0x00, 0x01, 0x80]).toString("base64");
		install(({ path }) =>
			path.startsWith("/repos/huggingface/trl/contents/assets/logo.png")
				? { json: { type: "file", encoding: "base64", size: 5, content: binary } }
				: undefined
		);
		const result = await readFile({ repo: "trl", path: "assets/logo.png" });

		expect(result.isError).toBe(false);
		expect(result.text).toContain("�");
	});

	it("says an empty file is empty rather than reaching for the raw fallback", async () => {
		// `content: ""` means either "empty file" or "too big for this endpoint"; `size`
		// is what tells them apart, and getting it wrong costs a pointless request.
		const recorder = install(serveFile(""));
		const result = await readFile({ repo: "trl", path: "examples/scripts/sft.py" });

		expect(result.isError).toBe(false);
		expect(result.text).toContain("The file is empty.");
		expect(result.text).not.toContain("```");
		expect(recorder.requests).toHaveLength(1);
	});

	it("cuts a single line that is longer than the whole character budget", async () => {
		// A minified or generated file is one line and can run to megabytes. The window
		// is line-granular, so without this the cap does not bind at all.
		install(serveFile("x".repeat(MAX_WINDOW_CHARS * 3)));
		const result = await readFile({ repo: "trl", path: "examples/scripts/sft.py" });

		expect(result.isError).toBe(false);
		expect(result.text.length).toBeLessThan(MAX_WINDOW_CHARS + 2_000);
		expect(result.text).toContain("cut mid-line");
	});

	it("cuts an oversized line reached through an explicit range too", async () => {
		install(serveFile(`short\n${"y".repeat(MAX_WINDOW_CHARS * 2)}\nshort`));
		const result = await readFile({
			repo: "trl",
			path: "examples/scripts/sft.py",
			line_start: 2,
			line_end: 2,
		});

		expect(result.text.length).toBeLessThan(MAX_WINDOW_CHARS + 2_000);
		expect(result.text).toContain("Line 2 is longer than");
	});

	it("requires a path, and says which tool finds one", async () => {
		const result = await readFile({ repo: "trl" });
		expect(result.isError).toBe(true);
		expect(result.text).toContain("github_find_examples");
	});
});

describe("readFile with notebooks", () => {
	const notebook = {
		nbformat: 4,
		metadata: { language_info: { name: "python" } },
		cells: [
			{ cell_type: "markdown", source: ["# Best of N\n", "\n", "A worked example.\n"] },
			{
				cell_type: "code",
				source: "from trl import BestOfNSampler\n",
				outputs: [{ output_type: "stream", text: ["a".repeat(5000)] }],
				execution_count: 1,
			},
			{ cell_type: "code", metadata: { tags: ["hide"] }, source: "!pip install -q trl\n" },
		],
	};

	const NOTEBOOK_PATH = "/repos/huggingface/trl/contents/examples/notebooks/best_of_n.ipynb";

	it("renders Markdown with outputs stripped and hidden cells dropped", async () => {
		install(({ path }) =>
			path.startsWith(NOTEBOOK_PATH) ? { json: fileOf(JSON.stringify(notebook)) } : undefined
		);
		const result = await readFile({ repo: "trl", path: "examples/notebooks/best_of_n.ipynb" });

		expect(result.text).toContain("# Best of N");
		expect(result.text).toContain("from trl import BestOfNSampler");
		expect(result.text).not.toContain("aaaa");
		expect(result.text).not.toContain("pip install");
		expect(result.text).toContain("line numbers index the conversion");
	});

	it("returns the raw JSON when the notebook will not parse", async () => {
		install(({ path }) =>
			path.startsWith(NOTEBOOK_PATH) ? { json: fileOf("{ not json at all") } : undefined
		);
		const result = await readFile({ repo: "trl", path: "examples/notebooks/best_of_n.ipynb" });

		expect(result.isError).toBe(false);
		expect(result.text).toContain("not json at all");
	});
});
