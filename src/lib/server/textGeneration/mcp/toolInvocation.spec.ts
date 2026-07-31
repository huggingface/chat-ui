import { describe, it, expect, vi, beforeEach } from "vitest";
import { MessageToolUpdateType, MessageUpdateType } from "$lib/types/MessageUpdate";
import { ToolResultStatus } from "$lib/types/Tool";
import type { McpToolTextResponse } from "$lib/server/mcp/httpClient";

const mcpMock = vi.hoisted(() => ({
	callMcpTool: vi.fn(),
}));

vi.mock("$lib/server/mcp/httpClient", () => ({
	callMcpTool: mcpMock.callMcpTool,
	getMcpToolTimeoutMs: () => 1_000,
}));

vi.mock("$lib/server/mcp/clientPool", () => ({
	getClient: vi.fn(async () => ({})),
}));

vi.mock("../../logger", () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { executeToolCalls } = await import("./toolInvocation");
type ToolExecutionEvent = Awaited<ReturnType<typeof drain>>[number];

const SERVERS = [{ name: "hf", url: "https://example.test/mcp" }];
const MAPPING = { do_thing: { fnName: "do_thing", server: "hf", tool: "do_thing" } };

function parseArgs(raw: unknown): Record<string, unknown> {
	if (typeof raw !== "string" || raw.trim().length === 0) return {};
	try {
		return JSON.parse(raw);
	} catch {
		return {};
	}
}

const toPrimitive = (value: unknown) =>
	typeof value === "string" || typeof value === "number" || typeof value === "boolean"
		? value
		: undefined;

const processToolOutput = (text: string) => ({ annotated: text, sources: [] });

async function drain() {
	const events = [];
	for await (const event of executeToolCalls({
		calls: [{ id: "call_1", name: "do_thing", arguments: '{"a":1}' }],
		mapping: MAPPING,
		servers: SERVERS,
		parseArgs,
		toPrimitive,
		processToolOutput,
	})) {
		events.push(event);
	}
	return events;
}

function toolMessagesOf(events: ToolExecutionEvent[]) {
	const complete = events.find((e) => e.type === "complete");
	if (complete?.type !== "complete") throw new Error("no completion event");
	return complete.summary;
}

function toolUpdatesOf(events: ToolExecutionEvent[]) {
	return events.flatMap((e) =>
		e.type === "update" && e.update.type === MessageUpdateType.Tool ? [e.update] : []
	);
}

function mcpResult(overrides: Partial<McpToolTextResponse>): McpToolTextResponse {
	return { text: "", isError: false, ...overrides };
}

beforeEach(() => {
	mcpMock.callMcpTool.mockReset();
});

describe("executeToolCalls", () => {
	it("reports a successful call as a success", async () => {
		mcpMock.callMcpTool.mockResolvedValue(mcpResult({ text: "all good" }));

		const events = await drain();
		const { toolMessages, toolRuns } = toolMessagesOf(events);

		expect(toolMessages).toEqual([{ role: "tool", tool_call_id: "call_1", content: "all good" }]);
		expect(toolRuns).toHaveLength(1);
		const result = toolUpdatesOf(events).find((u) => u.subtype === MessageToolUpdateType.Result);
		expect(result).toBeDefined();
		if (result?.subtype === MessageToolUpdateType.Result) {
			expect(result.result.status).toBe(ToolResultStatus.Success);
		}
	});

	// MCP reports tool failures as a normal result with `isError: true` rather than by
	// throwing, so this path never reaches the catch. Before the fix it was reported to
	// both the user and the model as a success.
	it("reports an isError result as a failure and tells the model", async () => {
		mcpMock.callMcpTool.mockResolvedValue(
			mcpResult({ text: "repo not found: acme/missing", isError: true })
		);

		const events = await drain();
		const { toolMessages, toolRuns } = toolMessagesOf(events);

		expect(toolMessages).toEqual([
			{ role: "tool", tool_call_id: "call_1", content: "Error: repo not found: acme/missing" },
		]);
		// A failed call produced no output, so it must not appear as a completed run.
		expect(toolRuns).toHaveLength(0);

		const updates = toolUpdatesOf(events);
		expect(updates.some((u) => u.subtype === MessageToolUpdateType.Result)).toBe(false);
		const error = updates.find((u) => u.subtype === MessageToolUpdateType.Error);
		expect(error).toBeDefined();
		if (error?.subtype === MessageToolUpdateType.Error) {
			expect(error.message).toBe("repo not found: acme/missing");
		}
	});

	it("falls back to a placeholder when an isError result carries no text", async () => {
		mcpMock.callMcpTool.mockResolvedValue(mcpResult({ text: "   ", isError: true }));

		const events = await drain();
		const { toolMessages } = toolMessagesOf(events);

		expect(toolMessages[0]).toEqual({
			role: "tool",
			tool_call_id: "call_1",
			content: "Error: The tool reported an error with no message.",
		});
	});

	it("still reports a thrown transport error as a failure", async () => {
		mcpMock.callMcpTool.mockRejectedValue(new Error("connection refused"));

		const events = await drain();
		const { toolMessages } = toolMessagesOf(events);

		expect(toolMessages[0]).toEqual({
			role: "tool",
			tool_call_id: "call_1",
			content: "Error: connection refused",
		});
	});
});
