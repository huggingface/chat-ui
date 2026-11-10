import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { ready } from "$lib/server/database";
import { readSpaceLogTail } from "$lib/server/hubSpaces";
import { recordConsoleEntries, recordFrameState } from "$lib/server/spaceConsole/store";
import type { MessageUpdate } from "$lib/types/MessageUpdate";
import { createCheckSpaceTool } from "./checkSpaceTool";
import type { BuiltinToolContext } from "./types";

const ctx = { uuid: "u", toolCallId: "t" } as BuiltinToolContext;
const HOST = "https://pngwn-demo.hf.space";

type Space = {
	sdk?: string;
	host?: string;
	private?: boolean;
	runtime?: { stage?: string; errorMessage?: string };
};

let space: Space | undefined;
let logs: Record<string, string>;
/** the hub log streams never end, most tests close them to skip the window */
let logsEnd: boolean;
let info: unknown;
let callEvents: string;
let postStatus: number;
let calls: { url: string; init?: RequestInit }[];

function sse(text: string, end = true, signal?: AbortSignal | null): Response {
	return new Response(
		new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new TextEncoder().encode(text));
				if (end) controller.close();
				signal?.addEventListener("abort", () => controller.error(signal.reason));
			},
		}),
		{ headers: { "Content-Type": "text/event-stream" } }
	);
}

const logLines = (...lines: string[]) =>
	lines
		.map(
			(l) => `data: ${JSON.stringify({ data: `${l}\n`, timestamp: "2026-11-10T00:00:00Z" })}\n\n`
		)
		.join("");

beforeEach(() => {
	space = { sdk: "gradio", host: HOST, runtime: { stage: "RUNNING" } };
	logs = {};
	logsEnd = true;
	info = {
		named_endpoints: {
			"/on_load": { parameters: [] },
			"/predict": {
				parameters: [
					{ parameter_name: "name", example_input: "Hello!!", parameter_has_default: false },
					{ parameter_name: "steps", parameter_has_default: true, parameter_default: 8 },
				],
			},
		},
	};
	callEvents = 'event: complete\ndata: ["Hello Hello!!!"]\n\n';
	postStatus = 200;
	calls = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: string, init?: RequestInit) => {
			calls.push({ url: input, init });
			const url = new URL(input);
			if (url.origin === "https://huggingface.co") {
				const logMatch = url.pathname.match(/^\/api\/spaces\/[^/]+\/[^/]+\/logs\/(build|run)$/);
				if (logMatch) {
					const body = logs[logMatch[1]];
					if (body === undefined) return new Response('{"error":"nope"}', { status: 403 });
					return sse(body, logsEnd, init?.signal);
				}
				if (!space) return new Response("", { status: 401 });
				return Response.json(space);
			}
			if (url.pathname === "/gradio_api/info") return Response.json(info);
			if (url.pathname === "/gradio_api/call/predict" && init?.method === "POST") {
				if (postStatus !== 200) return new Response("boom", { status: postStatus });
				return Response.json({ event_id: "ev1" });
			}
			if (url.pathname === "/gradio_api/call/predict/ev1") return sse(callEvents);
			return new Response("", { status: 404 });
		})
	);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

const run = async (args: Record<string, unknown>, token: string | undefined = "hf_user") => {
	const result = await createCheckSpaceTool(() => token).execute(args, ctx);
	if (!("resultText" in result)) throw new Error(JSON.stringify(result));
	return result.resultText;
};

const authOf = (url: string) =>
	calls
		.filter((c) => c.url.startsWith(url))
		.map((c) => new Headers(c.init?.headers).get("Authorization"));

describe("check_space", () => {
	it("refuses an id that is not owner/name", async () => {
		const result = await createCheckSpaceTool(() => "t").execute(
			{ space: "https://evil.example/x" },
			ctx
		);
		expect(result).toEqual({ error: expect.stringContaining("not a Space id") });
	});

	it("reports a Space the Hub does not resolve as an error", async () => {
		space = undefined;
		const result = await createCheckSpaceTool(() => "t").execute({ space: "pngwn/demo" }, ctx);
		expect(result).toEqual({ error: expect.stringContaining("does not resolve") });
	});

	it("points a building Space at wait without calling it", async () => {
		space = { ...space, runtime: { stage: "BUILDING" } };
		const text = await run({ space: "pngwn/demo" });
		expect(text).toContain("BUILDING");
		expect(text).toContain("Call wait");
		expect(calls.some((c) => c.url.startsWith(HOST))).toBe(false);
	});

	it("returns the build log tail on BUILD_ERROR", async () => {
		space = { ...space, runtime: { stage: "BUILD_ERROR", errorMessage: "Build failed" } };
		logs.build = logLines(
			...Array.from({ length: 80 }, (_, i) => `step ${i}`),
			"\u001b[31mERROR: No matching distribution for torch==9\u001b[0m"
		);
		const text = await run({ space: "pngwn/demo" });
		expect(text).toContain("Hub error:\nBuild failed");
		expect(text).toContain("Last 60 lines of the build log:");
		expect(text).toContain("ERROR: No matching distribution for torch==9");
		expect(text).not.toContain("\u001b");
		expect(text).not.toContain("step 20\n");
		expect(authOf("https://huggingface.co/api/spaces/pngwn/demo/logs/build")).toEqual([
			"Bearer hf_user",
		]);
	});

	it("returns the run log tail on RUNTIME_ERROR", async () => {
		const trace = `Exit code: 1. Traceback:\n${"  File x\n".repeat(400)}ImportError: cannot import name 'HfFolder'`;
		space = { ...space, runtime: { stage: "RUNTIME_ERROR", errorMessage: trace } };
		logs.run = logLines(
			"Traceback (most recent call last):",
			"ModuleNotFoundError: No module named 'x'"
		);
		const text = await run({ space: "pngwn/demo" });
		expect(text).toContain("Last 2 lines of the run log:");
		expect(text).toContain("ModuleNotFoundError");
		expect(text).toContain("Exit code: 1. Traceback:");
		expect(text).toContain("ImportError: cannot import name 'HfFolder'");
		expect(text).toContain("chars cut");
	});

	it("says so when the log cannot be read", async () => {
		space = { ...space, runtime: { stage: "RUNTIME_ERROR" } };
		const text = await run({ space: "pngwn/demo" });
		expect(text).toContain("Could not read the run log (this sign-in cannot read it).");
	});

	it("calls a running Gradio Space with the example inputs", async () => {
		const text = await run({ space: "pngwn/demo" });
		expect(text).toContain('Test call to /predict with ["Hello!!",8]:');
		expect(text).toContain('completed → ["Hello Hello!!!"]');
		const post = calls.find((c) => c.init?.method === "POST");
		expect(JSON.parse(String(post?.init?.body))).toEqual({ data: ["Hello!!", 8] });
	});

	it("uses the inputs it is given over the examples", async () => {
		await run({ space: "pngwn/demo", inputs: { name: "Ada" } });
		const post = calls.find((c) => c.init?.method === "POST");
		expect(JSON.parse(String(post?.init?.body))).toEqual({ data: ["Ada", 8] });
	});

	it("asks for inputs that have no example", async () => {
		info = {
			named_endpoints: {
				"/predict": {
					parameters: [
						{ parameter_name: "image" },
						{ parameter_name: "file", example_input: "..." },
					],
				},
			},
		};
		const text = await run({ space: "pngwn/demo" });
		expect(text).toContain("/predict needs image, file");
		expect(calls.some((c) => c.init?.method === "POST")).toBe(false);
	});

	it("attaches the run log when the call errors without a message", async () => {
		callEvents = 'event: error\ndata: {"error": null}\n\n';
		logs.run = logLines("ValueError: bad shape");
		const text = await run({ space: "pngwn/demo" });
		expect(text).toContain("failed: the app raised an exception without a message");
		expect(text).toContain("ValueError: bad shape");
	});

	it("keeps a gr.Error message", async () => {
		callEvents = 'event: error\ndata: {"error": "Upload an image first"}\n\n';
		logs.run = logLines("ok");
		expect(await run({ space: "pngwn/demo" })).toContain("failed: Upload an image first");
	});

	it("reports a refused call with its status", async () => {
		postStatus = 500;
		logs.run = logLines("ok");
		expect(await run({ space: "pngwn/demo" })).toContain("the call was refused (500) boom");
	});

	it("reads the result past generating events", async () => {
		callEvents =
			'event: generating\ndata: ["Hel"]\n\nevent: heartbeat\ndata: null\n\nevent: complete\ndata: ["Hello"]\n\n';
		expect(await run({ space: "pngwn/demo" })).toContain('completed → ["Hello"]');
	});

	it("does not test a Space that is not Gradio", async () => {
		space = { sdk: "docker", host: HOST, runtime: { stage: "RUNNING" } };
		const text = await run({ space: "pngwn/demo" });
		expect(text).toContain("docker Space");
		expect(calls.some((c) => c.url.startsWith(HOST))).toBe(false);
	});

	it("never sends the token to a public Space's host", async () => {
		await run({ space: "pngwn/demo" });
		const hostAuth = authOf(HOST);
		expect(hostAuth.length).toBeGreaterThan(0);
		expect(hostAuth.every((auth) => auth === null)).toBe(true);
	});

	it("sends the token to a private Space's own host", async () => {
		space = { ...space, private: true };
		const text = await run({ space: "pngwn/demo" });
		expect(text).toContain("(private)");
		expect(authOf(HOST).every((auth) => auth === "Bearer hf_user")).toBe(true);
	});

	it("never calls a host the Hub returns outside *.hf.space", async () => {
		space = { ...space, private: true, host: "https://evil.example" };
		const text = await run({ space: "pngwn/demo" });
		expect(text).toContain("no Gradio API to test");
		expect(calls.some((c) => c.url.startsWith("https://evil.example"))).toBe(false);
	});
});

describe("readSpaceLogTail", () => {
	it("cuts off a stream that never ends and keeps what it read", async () => {
		logsEnd = false;
		logs.run = logLines("one", "two", "three");
		const started = Date.now();
		const tail = await readSpaceLogTail("pngwn/demo", "run", "t", { windowMs: 200, maxLines: 2 });
		expect(Date.now() - started).toBeLessThan(2000);
		expect(tail).toEqual({ lines: ["two", "three"] });
	});

	it("keeps the last frame of a progress bar and raw lines", async () => {
		logsEnd = false;
		logs.build = "data: Downloading 10%\rDownloading 100%\n\ndata: plain line\n\n";
		const tail = await readSpaceLogTail("pngwn/demo", "build", "t", { windowMs: 200 });
		expect(tail).toEqual({ lines: ["Downloading 100%", "plain line"] });
	});
});

describe("check_space console section", () => {
	const FAST = { attachMs: 300, handshakeMs: 300, settleMs: 30, pollMs: 20 };

	beforeAll(async () => {
		await ready;
	});

	function live(conversationId = new ObjectId()) {
		const emitted: MessageUpdate[] = [];
		const liveCtx = {
			...ctx,
			uuid: `check-${conversationId}`,
			conversationId,
			elicitationSink: { conversationId, emit: (u: MessageUpdate) => emitted.push(u) },
		} as BuiltinToolContext;
		return { emitted, liveCtx, conversationId };
	}

	const text = async (c: BuiltinToolContext) => {
		const result = await createCheckSpaceTool(() => "hf_user", FAST).execute(
			{ space: "pngwn/demo" },
			c
		);
		if (!("resultText" in result)) throw new Error(JSON.stringify(result));
		return result.resultText;
	};

	it("opens the Space in the tab with a progress update carrying the header line", async () => {
		const { emitted, liveCtx } = live();
		const out = await text(liveCtx);
		expect(emitted).toEqual([
			{
				type: "tool",
				subtype: "progress",
				uuid: liveCtx.uuid,
				progress: 0,
				message: "Space pngwn/demo: RUNNING — https://huggingface.co/spaces/pngwn/demo",
			},
		]);
		expect(out.split("\n")[0]).toBe(
			emitted[0].type === "tool" && "message" in emitted[0] ? emitted[0].message : ""
		);
		expect(out).toContain('completed → ["Hello Hello!!!"]');
		expect(out.trim().split("\n").at(-1)).toBe(
			"Console: no browser tab has this Space open, so its browser console can't be read."
		);
	});

	it("returns what the tab's frame forwarded for this check", async () => {
		const { liveCtx, conversationId } = live();
		const base = { conversationId, spaceId: "pngwn/demo", loadId: "l1" };
		await recordFrameState({ ...base, checkId: liveCtx.uuid, state: "loading" });
		await recordFrameState({
			...base,
			state: "connected",
			sessionId: "s1",
			gradioVersion: "6.31.0",
		});
		await recordConsoleEntries(conversationId, "pngwn/demo", [
			{ sessionId: "s1", seq: 1, ts: 1, level: "error", text: "Failed to load module script" },
		]);
		const out = await text(liveCtx);
		expect(out).toContain("Console (browser tab, Gradio 6.31.0): 1 entry, oldest first:");
		expect(out).toContain("  [error] Failed to load module script");
	});

	it("says so in one line when the run has no tab to open it in", async () => {
		const out = await text({ ...ctx, conversationId: new ObjectId() } as BuiltinToolContext);
		expect(out.trim().split("\n").at(-1)).toBe(
			"Console: no browser tab is attached to this run, so its browser console can't be read."
		);
	});

	it("does not open a Space that is not running Gradio", async () => {
		space = { ...space, runtime: { stage: "RUNTIME_ERROR" } };
		const { emitted, liveCtx } = live();
		const out = await text(liveCtx);
		expect(emitted).toEqual([]);
		expect(out).not.toContain("Console");
	});
});
