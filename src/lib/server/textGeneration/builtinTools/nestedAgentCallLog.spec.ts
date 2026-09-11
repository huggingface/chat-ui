import { describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

const insertMany = vi.fn().mockResolvedValue({ insertedCount: 0 });
vi.mock("$lib/server/database", () => ({
	collections: { nestedAgentCalls: { insertMany: (...args: unknown[]) => insertMany(...args) } },
}));

const { recordNestedAgentCalls, redactSecrets } = await import("./nestedAgentCallLog");

const ctx = { conversationId: new ObjectId(), messageId: "msg-1", generationId: "gen-1" };

const call = (id: string, name: string, args: string, repeatCount = 1) => ({
	id,
	name,
	arguments: args,
	repeatCount,
});
const ok = (id: string, text = "fine"): ChatCompletionMessageParam =>
	({ role: "tool", tool_call_id: id, content: text }) as ChatCompletionMessageParam;
const err = (id: string, text: string): ChatCompletionMessageParam =>
	({ role: "tool", tool_call_id: id, content: `Error: ${text}` }) as ChatCompletionMessageParam;

function rowsFrom(
	calls: Parameters<typeof recordNestedAgentCalls>[3],
	toolMessages: ChatCompletionMessageParam[] = [],
	refused: Parameters<typeof recordNestedAgentCalls>[5] = []
) {
	insertMany.mockClear();
	recordNestedAgentCalls(ctx, "sandbox", 3, calls, toolMessages, refused);
	return (insertMany.mock.calls[0]?.[0] ?? []) as Array<Record<string, unknown>>;
}

describe("nested agent call log", () => {
	it("keeps the real command, not the lossy update parameters", () => {
		const args = '{"cmd":"exec","args":["exec","sbx-1","tail -5 /tmp/run2.log"]}';
		const rows = rowsFrom([call("c1", "hf_sandbox_exec", args)], [ok("c1")]);

		expect(rows[0].arguments).toContain("tail -5 /tmp/run2.log");
		expect(rows[0]).toMatchObject({ toolName: "hf_sandbox_exec", status: "success" });
	});

	it("records the repeat count that makes a polling loop visible", () => {
		const args = '{"cmd":"exec","args":["exec","sbx-1","tail /tmp/run2.log"]}';
		const rows = rowsFrom([call("c1", "hf_sandbox_exec", args, 7)], [ok("c1")]);

		expect(rows[0]).toMatchObject({ repeatCount: 7, status: "success" });
	});

	it("keeps the server's rejection text verbatim", () => {
		const rows = rowsFrom(
			[call("c1", "hf_sandbox_exec", "{}")],
			[err("c1", 'Input validation error: cmd: Invalid input: expected "exec"')]
		);

		expect(rows[0]).toMatchObject({ status: "error" });
		expect(rows[0].error).toContain('expected "exec"');
	});

	it("never writes a credential into the database", () => {
		const args = JSON.stringify({
			args: [
				"exec",
				"sbx-1",
				'export HF_TOKEN=hf_AbCdEfGhIjKlMnOpQrSt && curl -H "Authorization: Bearer sk-live-abcdefgh1234"',
			],
		});
		const rows = rowsFrom([call("c1", "hf_sandbox_exec", args)], [ok("c1")]);

		const serialized = JSON.stringify(rows);
		expect(serialized).not.toContain("hf_AbCdEfGhIjKlMnOpQrSt");
		expect(serialized).not.toContain("sk-live-abcdefgh1234");
		expect(serialized).toContain("<redacted>");
	});

	it("redacts a quoted secret whole, not just its first word", () => {
		// Reported in review: a value class that stops at whitespace leaves most of
		// `PASSWORD="correct horse battery staple"` in the database.
		const out = redactSecrets('PASSWORD="correct horse battery staple" --epochs 3');

		expect(out).not.toContain("horse");
		expect(out).not.toContain("staple");
		expect(out).toContain("--epochs 3");
	});

	it("redacts a credential passed as a CLI flag", () => {
		// The other reported gap: whitespace-separated flags matched nothing.
		expect(redactSecrets("train --password hunter2 --epochs 3")).not.toContain("hunter2");
		expect(redactSecrets("train --api-key=abcdefgh12345 --epochs 3")).not.toContain("abcdefgh");
		expect(redactSecrets("train --password hunter2 --epochs 3")).toContain("--epochs 3");
	});

	it("leaves an ordinary command alone", () => {
		const cmd = "python train.py --epochs 3 --lr 0.001 --batch-size 8";
		expect(redactSecrets(cmd)).toBe(cmd);
	});

	it("redacts assignments without swallowing the command around them", () => {
		const out = redactSecrets("python train.py --token=hf_SecretValue123 --epochs 3");

		expect(out).not.toContain("hf_SecretValue123");
		expect(out).toContain("python train.py");
		expect(out).toContain("--epochs 3");
	});

	it("truncates a long command and never stores output", () => {
		const rows = rowsFrom([call("c1", "hf_sandbox_exec", "x".repeat(5_000))], [ok("c1")]);

		expect((rows[0].arguments as string).length).toBeLessThan(700);
		expect(rows[0]).not.toHaveProperty("output");
	});

	it("counts a call the executor never answered", () => {
		const rows = rowsFrom([call("c1", "hf_sandbox_fs", "{}")], []);

		expect(rows[0]).toMatchObject({ status: "error", error: "no result observed for this call" });
	});

	it("records a refused call with its arguments and repeat count", () => {
		// A refusal never reaches the executor, so it carries its own metadata —
		// otherwise a refusal loop, the thing this log exists to surface, reads as
		// a series of unrelated first attempts.
		const rows = rowsFrom([], [], [call("c1", "hf_jobs", '{"operation":"uv"}', 3)]);

		expect(rows[0]).toMatchObject({ toolName: "hf_jobs", status: "error", repeatCount: 3 });
		expect(rows[0].arguments).toContain("uv");
		expect(rows[0].error).toContain("not available");
	});

	it("writes nothing when the iteration made no calls", () => {
		insertMany.mockClear();
		recordNestedAgentCalls(ctx, "sandbox", 0, [], [], []);
		expect(insertMany).not.toHaveBeenCalled();
	});

	it("never throws into the sub-agent loop when the insert fails", () => {
		insertMany.mockClear();
		insertMany.mockRejectedValueOnce(new Error("mongo down"));
		expect(() =>
			recordNestedAgentCalls(ctx, "sandbox", 1, [call("c1", "hf_sandbox_exec", "{}")], [ok("c1")])
		).not.toThrow();
	});
});
