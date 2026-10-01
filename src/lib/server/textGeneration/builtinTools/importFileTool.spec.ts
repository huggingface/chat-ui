import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { collections, ready } from "$lib/server/database";
import { ML_FILE_VERSION_INDEX } from "$lib/server/mlFiles/indexes";
import type { BuiltinToolContext, BuiltinToolResult } from "./types";

vi.mock("$lib/server/logger", () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("$lib/server/mcp/httpClient", () => ({
	callMcpTool: vi.fn(),
	getMcpToolTimeoutMs: () => 1_000,
}));
vi.mock("$lib/server/mcp/clientPool", () => ({ getClient: vi.fn(async () => ({})) }));

const { callMcpTool } = await import("$lib/server/mcp/httpClient");
const { createImportFileTool } = await import("./importFileTool");
const { createFileTools } = await import("./fileTools");
type NestedAgentDeps = import("./nestedAgent").NestedAgentDeps;

const HUB = { name: "Hugging Face", url: "https://hf.co/mcp?login" };
const OTHER = { name: "Someone else", url: "https://other.test/mcp" };
const HANDLE = "hfsb2:pngwn:6a99a386e686246ca699f46f";
const SANDBOX = { handle: HANDLE, path: "/work/train.py" };
const URI = "hf://models/org/repo/train.py";

const ctx: BuiltinToolContext = {
	uuid: "uuid-1",
	toolCallId: "call-1",
	messageId: "msg-1",
	generationId: "gen-1",
};

const makeDeps = (servers = [HUB]): NestedAgentDeps => ({
	openai: {} as never,
	completionBase: { model: "test-model", stream: true },
	requestHeaders: {},
	servers,
	mapping: {},
	mcpTools: [],
	hostBuiltinTools: [],
});

function tools(servers = [HUB]) {
	const conv = { _id: new ObjectId() };
	const tool = createImportFileTool(conv);
	tool.bind(makeDeps(servers));
	const [write] = createFileTools(conv);
	return { conv, tool, write };
}

const bytesOf = (text: string) => Buffer.byteLength(text, "utf8");

/** the envelope hf_sandbox_fs cat returns plus its fenced markdown view */
const sandboxPage = (content: string, cut?: { size: number; nextOffset: number }) => ({
	text: `\`\`\`\n${content}\n\`\`\``,
	isError: false,
	structured: {
		op: "cat",
		path: SANDBOX.path,
		content,
		bytes: bytesOf(content),
		size: cut?.size ?? bytesOf(content),
		truncated: cut !== undefined,
		...(cut ? { next_offset: cut.nextOffset } : {}),
	},
});

/** the batch envelope hf_fs cat returns */
const hubPage = (content: string, nextOffset?: number) => ({
	text: "",
	isError: false,
	structured: {
		results: [
			{
				index: 0,
				status: "success",
				result: {
					uri: URI,
					op: "cat",
					path: "train.py",
					content,
					bytes: bytesOf(content),
					truncated: nextOffset !== undefined,
					...(nextOffset !== undefined
						? { truncation_reason: "max_bytes", next_offset: nextOffset }
						: {}),
				},
			},
		],
	},
});

const textOf = (outcome: BuiltinToolResult) =>
	"resultText" in outcome
		? outcome.resultText
		: `ERROR: ${"error" in outcome ? outcome.error : ""}`;

const call = (n: number) => {
	const [server, tool, args, options] = vi.mocked(callMcpTool).mock.calls[n];
	return { server, tool, args: args as Record<string, unknown>, options };
};

const SCRIPT = ["import torch", "", "lr = 1e-4", "steps = 100", "print(lr, steps)", ""].join("\n");

beforeAll(async () => {
	await ready;
	await collections.mlFiles.createIndex(ML_FILE_VERSION_INDEX.keys, ML_FILE_VERSION_INDEX.options);
});

beforeEach(() => vi.mocked(callMcpTool).mockReset());

afterEach(async () => {
	await collections.mlFiles.deleteMany({});
});

describe("import_file from a sandbox", () => {
	it("joins the pages in order, stores one version, and answers with the shape only", async () => {
		const { conv, tool } = tools();
		const first = SCRIPT.slice(0, 20);
		const second = SCRIPT.slice(20);
		vi.mocked(callMcpTool)
			.mockResolvedValueOnce(
				sandboxPage(first, { size: bytesOf(SCRIPT), nextOffset: bytesOf(first) })
			)
			.mockResolvedValueOnce(sandboxPage(second));

		const text = textOf(
			await tool.execute(
				{ name: "train.py", source: SANDBOX, summary: "fixed in the sandbox" },
				{ ...ctx, agent: "sandbox" }
			)
		);

		expect(text).toContain(`Imported train.py v1 from ${HANDLE}:/work/train.py`);
		expect(text).toContain("5 lines; first version");
		expect(text).toContain("v-file://train.py@v1");
		expect(text).not.toContain("import torch");
		expect(text).not.toContain("print(lr");

		expect(call(0).server).toBe(HUB);
		expect(call(0).tool).toBe("hf_sandbox_fs");
		expect(call(0).args).toEqual({
			cmd: "cat",
			args: ["cat", HANDLE, "/work/train.py", "--offset", "0", "--max-bytes", "100000"],
		});
		expect(call(0).options).toMatchObject({ clientKind: "intern" });
		expect(call(1).args).toMatchObject({
			args: [
				"cat",
				HANDLE,
				"/work/train.py",
				"--offset",
				String(bytesOf(first)),
				"--max-bytes",
				"100000",
			],
		});

		const stored = await collections.mlFiles.find({ conversationId: conv._id }).toArray();
		expect(stored).toHaveLength(1);
		expect(stored[0]).toMatchObject({
			name: "train.py",
			version: 1,
			content: SCRIPT,
			origin: "import",
			source: `${HANDLE}:/work/train.py`,
			summary: "fixed in the sandbox",
			messageId: "msg-1",
			generationId: "gen-1",
			toolUuid: "uuid-1",
			agent: "sandbox",
		});
	});

	it("restarts a page that ended inside a multi-byte character from the clean prefix", async () => {
		// café is 6 bytes, a cut after 4 leaves the é half read and decoded to U+FFFD
		const { conv, tool } = tools();
		vi.mocked(callMcpTool)
			.mockResolvedValueOnce(sandboxPage("caf�", { size: 6, nextOffset: 4 }))
			.mockResolvedValueOnce(sandboxPage("é!"));

		await tool.execute({ name: "note.txt", source: SANDBOX }, ctx);

		expect(call(1).args).toMatchObject({
			args: ["cat", HANDLE, "/work/train.py", "--offset", "3", "--max-bytes", "100000"],
		});
		const stored = await collections.mlFiles.findOne({ conversationId: conv._id });
		expect(stored?.content).toBe("café!");
	});

	it("reads the fenced markdown view when the server sends no structured content", async () => {
		const { conv, tool } = tools();
		vi.mocked(callMcpTool)
			.mockResolvedValueOnce({
				text: "```\nab\n```\n\n_Read 2 of 4 bytes. Resume with offset 2._",
				isError: false,
			})
			.mockResolvedValueOnce({ text: "```\ncd\n```", isError: false });

		const text = textOf(await tool.execute({ name: "x.py", source: SANDBOX }, ctx));

		expect(text).toContain("Imported x.py v1");
		expect(call(1).args).toMatchObject({ args: expect.arrayContaining(["--offset", "2"]) });
		const stored = await collections.mlFiles.findOne({ conversationId: conv._id });
		expect(stored?.content).toBe("abcd");
	});

	it("diffs against the previous version and names it", async () => {
		const { conv, tool, write } = tools();
		await write.execute({ name: "train.py", content: SCRIPT }, ctx);
		vi.mocked(callMcpTool).mockResolvedValueOnce(
			sandboxPage(SCRIPT.replace("lr = 1e-4", "lr = 1e-5"))
		);

		const text = textOf(await tool.execute({ name: "train.py", source: SANDBOX }, ctx));

		expect(text).toContain("Imported train.py v2 from");
		expect(text).toContain("was v1");
		expect(text).toContain("-lr = 1e-4");
		expect(text).toContain("+lr = 1e-5");
		expect(text).not.toContain("import torch");
		expect(await collections.mlFiles.countDocuments({ conversationId: conv._id })).toBe(2);
	});

	it("writes nothing when the file is identical to the latest version", async () => {
		const { conv, tool, write } = tools();
		await write.execute({ name: "train.py", content: SCRIPT }, ctx);
		vi.mocked(callMcpTool).mockResolvedValueOnce(sandboxPage(SCRIPT));

		const text = textOf(await tool.execute({ name: "train.py", source: SANDBOX }, ctx));

		expect(text).toBe(
			`train.py v1 is already identical to ${HANDLE}:/work/train.py; nothing was written.`
		);
		expect(await collections.mlFiles.countDocuments({ conversationId: conv._id })).toBe(1);
	});

	it("refuses a file over the size cap from its reported size, before reading it all", async () => {
		const { conv, tool } = tools();
		vi.mocked(callMcpTool).mockResolvedValueOnce(
			sandboxPage("x".repeat(100), { size: 300 * 1024, nextOffset: 100 })
		);

		const text = textOf(await tool.execute({ name: "big.bin", source: SANDBOX }, ctx));

		expect(text).toContain("ERROR");
		expect(text).toContain("256 KB");
		expect(vi.mocked(callMcpTool)).toHaveBeenCalledTimes(1);
		expect(await collections.mlFiles.countDocuments({ conversationId: conv._id })).toBe(0);
	});

	it("refuses binary content before writing", async () => {
		const { conv, tool } = tools();
		vi.mocked(callMcpTool).mockResolvedValueOnce(sandboxPage("abc\u0000def"));

		const text = textOf(await tool.execute({ name: "model.bin", source: SANDBOX }, ctx));

		expect(text).toContain("text only");
		expect(await collections.mlFiles.countDocuments({ conversationId: conv._id })).toBe(0);
	});

	it("surfaces the sandbox tool's own error text", async () => {
		const { conv, tool } = tools();
		vi.mocked(callMcpTool).mockResolvedValueOnce({
			text: "no such file: /work/train.py",
			isError: true,
		});

		const text = textOf(await tool.execute({ name: "train.py", source: SANDBOX }, ctx));

		expect(text).toContain("hf_sandbox_fs cat refused: no such file: /work/train.py");
		expect(await collections.mlFiles.countDocuments({ conversationId: conv._id })).toBe(0);
	});

	it("reports a transport failure without throwing", async () => {
		const { tool } = tools();
		vi.mocked(callMcpTool).mockRejectedValueOnce(new Error("socket hang up"));

		const text = textOf(await tool.execute({ name: "train.py", source: SANDBOX }, ctx));

		expect(text).toContain(`Could not read ${HANDLE}:/work/train.py: socket hang up`);
	});
});

describe("import_file from the Hub", () => {
	it("reads the file through hf_fs in pages and stores the URI as the source", async () => {
		const { conv, tool } = tools();
		const first = SCRIPT.slice(0, 30);
		const second = SCRIPT.slice(30);
		vi.mocked(callMcpTool)
			.mockResolvedValueOnce(hubPage(first, bytesOf(first)))
			.mockResolvedValueOnce(hubPage(second));

		const text = textOf(await tool.execute({ name: "train.py", source: URI }, ctx));

		expect(text).toContain(`Imported train.py v1 from ${URI}`);
		expect(call(0).tool).toBe("hf_fs");
		expect(call(0).args).toEqual({
			operations: [{ cmd: "cat", args: [URI, "--offset", "0", "--max-bytes", "32000"] }],
		});
		expect(call(1).args).toEqual({
			operations: [
				{ cmd: "cat", args: [URI, "--offset", String(bytesOf(first)), "--max-bytes", "32000"] },
			],
		});
		const stored = await collections.mlFiles.findOne({ conversationId: conv._id });
		expect(stored).toMatchObject({ content: SCRIPT, origin: "import", source: URI });
	});

	it("refuses once the pages pass the size cap, without writing", async () => {
		const { conv, tool } = tools();
		const page = "x".repeat(200 * 1024);
		vi.mocked(callMcpTool)
			.mockResolvedValueOnce(hubPage(page, page.length))
			.mockResolvedValueOnce(hubPage("y".repeat(100 * 1024)));

		const text = textOf(await tool.execute({ name: "data.csv", source: URI }, ctx));

		expect(text).toContain("256 KB");
		expect(await collections.mlFiles.countDocuments({ conversationId: conv._id })).toBe(0);
	});

	it("surfaces a failed item's message and recovery", async () => {
		const { tool } = tools();
		vi.mocked(callMcpTool).mockResolvedValueOnce({
			text: "",
			isError: false,
			structured: {
				results: [
					{
						index: 0,
						status: "error",
						error: {
							code: "ENOENT",
							message: "File does not exist: train.py",
							recovery: "Run ls on the repo first.",
						},
					},
				],
			},
		});

		const text = textOf(await tool.execute({ name: "train.py", source: URI }, ctx));

		expect(text).toContain(`hf_fs could not read ${URI}: File does not exist: train.py`);
		expect(text).toContain("Run ls on the repo first.");
	});
});

describe("import_file arguments and wiring", () => {
	it("takes exactly one source form", async () => {
		const { tool } = tools();

		expect(textOf(await tool.execute({ name: "a.py", source: 42 }, ctx))).toContain(
			"Invalid import_file arguments at source"
		);
		expect(textOf(await tool.execute({ name: "a.py", source: "s3://bucket/a.py" }, ctx))).toContain(
			"Invalid import_file arguments at source"
		);
		expect(textOf(await tool.execute({ name: "a.py", source: { handle: HANDLE } }, ctx))).toContain(
			"Invalid import_file arguments at source"
		);
		expect(textOf(await tool.execute({ name: "../a.py", source: URI }, ctx))).toContain("ERROR");
		expect(vi.mocked(callMcpTool)).not.toHaveBeenCalled();
	});

	it("errors before bind instead of dereferencing missing deps", async () => {
		const outcome = await createImportFileTool({ _id: new ObjectId() }).execute(
			{ name: "a.py", source: URI },
			ctx
		);

		expect("error" in outcome && outcome.error).toContain("not initialized");
	});

	it("reads only through the Hub server, never another server with the same tools", async () => {
		const { tool } = tools([OTHER]);

		const text = textOf(await tool.execute({ name: "a.py", source: URI }, ctx));

		expect(text).toContain("No Hugging Face MCP server");
		expect(vi.mocked(callMcpTool)).not.toHaveBeenCalled();
	});
});
