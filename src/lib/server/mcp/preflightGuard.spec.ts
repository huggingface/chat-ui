import { describe, it, expect, vi } from "vitest";
import { fromJsonSchema } from "@modelcontextprotocol/client";

// The real validator, wrapped so the compile can be counted.
vi.mock("@modelcontextprotocol/client", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@modelcontextprotocol/client")>();
	return { ...actual, fromJsonSchema: vi.fn(actual.fromJsonSchema) };
});
import { createSchemaPreflightGuard } from "./preflightGuard";
import type { McpToolMapping } from "./tools";

/** hf_sandbox_exec's real published schema, which is what these calls broke. */
const SANDBOX_EXEC_SCHEMA = {
	type: "object",
	additionalProperties: false,
	required: ["cmd", "args"],
	properties: {
		cmd: { type: "string", enum: ["exec"] },
		args: { type: "array", items: { type: "string" } },
	},
};

const mapping = (inputSchema?: Record<string, unknown>): Record<string, McpToolMapping> => ({
	hf_sandbox_exec: {
		fnName: "hf_sandbox_exec",
		server: "Hugging Face",
		tool: "hf_sandbox_exec",
		...(inputSchema ? { inputSchema } : {}),
	},
});

const ask = (guard: ReturnType<typeof createSchemaPreflightGuard>, args: Record<string, unknown>) =>
	guard.before({
		serverUrl: "https://hf.co/mcp?login",
		tool: "hf_sandbox_exec",
		fnName: "hf_sandbox_exec",
		args,
		callUuid: "uuid-1",
	});

describe("schema preflight guard", () => {
	it("refuses the shell command sent as cmd", async () => {
		// 8 of 34 server round trips in the traces. `cmd` takes one literal value.
		const verdict = await ask(createSchemaPreflightGuard(mapping(SANDBOX_EXEC_SCHEMA)), {
			cmd: "python -c 'import torch'",
			args: ["exec", "hfsb2:x:y"],
		});

		expect(verdict.allow).toBe(false);
		if (verdict.allow) return;
		expect(verdict.message).toContain("hf_sandbox_exec");
		expect(verdict.message).toContain("Nothing was sent");
	});

	it("refuses a timeout written as a top-level key", async () => {
		// The sibling hf_jobs takes exactly that, and the schema says
		// additionalProperties: false — which the provider did not enforce.
		const verdict = await ask(createSchemaPreflightGuard(mapping(SANDBOX_EXEC_SCHEMA)), {
			cmd: "exec",
			args: ["exec", "hfsb2:x:y", "sleep 1"],
			timeout: 55,
		});

		expect(verdict.allow).toBe(false);
	});

	it("refuses args sent as a string instead of a token list", async () => {
		const verdict = await ask(createSchemaPreflightGuard(mapping(SANDBOX_EXEC_SCHEMA)), {
			cmd: "exec",
			args: "exec hfsb2:x:y ls",
		});

		expect(verdict.allow).toBe(false);
	});

	it("passes a well-formed call through with a ticket", async () => {
		const verdict = await ask(createSchemaPreflightGuard(mapping(SANDBOX_EXEC_SCHEMA)), {
			cmd: "exec",
			args: ["exec", "hfsb2:x:y", "ls -la", "--timeout", "55"],
		});

		expect(verdict.allow).toBe(true);
		// A ticket has to come back or `after` never runs for the guards behind it.
		if (verdict.allow) expect(verdict.ticket).toBeDefined();
	});

	it("says nothing about the grammar inside args, which the schema does not describe", async () => {
		// Token order and flag names live in the description, so a nonsense token
		// list is schema-valid. Refusing it here would be stricter than the server.
		const verdict = await ask(createSchemaPreflightGuard(mapping(SANDBOX_EXEC_SCHEMA)), {
			cmd: "exec",
			args: ["exec", "--not-a-real-flag", "in the wrong order"],
		});

		expect(verdict.allow).toBe(true);
	});

	it("allows the call when the server published no schema", async () => {
		const verdict = await ask(createSchemaPreflightGuard(mapping()), { anything: true });
		expect(verdict.allow).toBe(true);
	});

	it("allows the call when the schema will not compile", async () => {
		// Every uncertainty resolves to allowing: a validator we cannot build must
		// never be the reason a working call is refused.
		const verdict = await ask(
			createSchemaPreflightGuard(
				mapping({ type: "object", properties: { x: { $ref: "#/nope" } } })
			),
			{ x: 1 }
		);

		expect(verdict.allow).toBe(true);
	});

	it("allows a tool the mapping does not cover", async () => {
		const guard = createSchemaPreflightGuard(mapping(SANDBOX_EXEC_SCHEMA));
		const verdict = await guard.before({
			serverUrl: "https://example.test/mcp",
			tool: "something_else",
			fnName: "something_else",
			args: { cmd: "wrong" },
			callUuid: "uuid-2",
		});

		expect(verdict.allow).toBe(true);
	});

	it("enforces only what the schema states, not what the description says", async () => {
		// The description caps --timeout at 55; the schema does not mention it, so
		// a 900 in the token list is not this guard's business.
		const verdict = await ask(createSchemaPreflightGuard(mapping(SANDBOX_EXEC_SCHEMA)), {
			cmd: "exec",
			args: ["exec", "hfsb2:x:y", "sleep 900", "--timeout", "900"],
		});

		expect(verdict.allow).toBe(true);
	});

	it("compiles a tool's schema once, however many calls it checks", async () => {
		const guard = createSchemaPreflightGuard(mapping(SANDBOX_EXEC_SCHEMA));
		vi.mocked(fromJsonSchema).mockClear();

		for (let i = 0; i < 5; i += 1) await ask(guard, { cmd: "exec", args: ["exec"] });

		// This runs on every tool call of every turn; compiling a schema each time
		// would put ajv in the hot path for no reason.
		expect(vi.mocked(fromJsonSchema)).toHaveBeenCalledTimes(1);
	});
});
