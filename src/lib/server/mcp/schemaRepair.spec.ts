import { describe, it, expect } from "vitest";
import { withRepairedToolSchemas } from "./schemaRepair";
import type { McpToolMapping, OpenAiTool } from "./tools";
import type { McpServerConfig } from "./httpClient";

const HUB: McpServerConfig[] = [{ name: "Hugging Face", url: "https://hf.co/mcp?login" }];

const mapping = (fnName: string, tool: string): Record<string, McpToolMapping> => ({
	[fnName]: { fnName, server: "Hugging Face", tool },
});

/** The Hub's own shape for the sandbox family: a selector and an opaque token list. */
const sandboxExec = (): OpenAiTool => ({
	type: "function",
	function: {
		name: "hf_sandbox_exec",
		description: "Run a shell command inside a Hugging Face Sandbox. Grammar; …",
		parameters: {
			type: "object",
			additionalProperties: false,
			required: ["cmd", "args"],
			properties: {
				cmd: { type: "string", enum: ["exec"], description: "Command to execute." },
				args: { type: "array", items: { type: "string" }, description: "Command arguments; …" },
			},
		},
	},
});

describe("withRepairedToolSchemas", () => {
	it("says what cmd is for, since its own description reads as the command to run", () => {
		const [repaired] = withRepairedToolSchemas(
			[sandboxExec()],
			mapping("hf_sandbox_exec", "hf_sandbox_exec"),
			HUB
		);
		const props = repaired.function.parameters?.properties as Record<
			string,
			{ description: string }
		>;

		// The largest single rejection class in the traces: the shell command sent
		// as `cmd`, whose only legal value is the literal "exec".
		expect(props.cmd.description).toContain('literal "exec"');
		expect(props.cmd.description).toContain("args");
	});

	it("puts the timeout token where it belongs, and names the tool it is confused with", () => {
		const [repaired] = withRepairedToolSchemas(
			[sandboxExec()],
			mapping("hf_sandbox_exec", "hf_sandbox_exec"),
			HUB
		);
		const args = (
			repaired.function.parameters?.properties as Record<string, { description: string }>
		).args.description;

		expect(args).toContain("--timeout");
		expect(args).toContain("hf_jobs");
	});

	it("tells hf_jobs apart: an object, not a token list", () => {
		const jobs: OpenAiTool = {
			type: "function",
			function: {
				name: "hf_jobs",
				parameters: {
					type: "object",
					properties: {
						operation: { type: "string", enum: ["run", "uv", "logs"] },
						args: { type: "object", description: "Operation-specific arguments as a JSON object" },
					},
				},
			},
		};
		const [repaired] = withRepairedToolSchemas([jobs], mapping("hf_jobs", "hf_jobs"), HUB);
		const args = (
			repaired.function.parameters?.properties as Record<string, { description: string }>
		).args.description;

		expect(args).toContain("JSON object");
		expect(args).toContain("timeout");
	});

	it("gives run the literal shape uv already had, and maps the CLI flags onto it", () => {
		// Six of the seven parameter rejections in the traces were on `run`, and
		// every one was a type the Hub's CLI docs express as a flag: --timeout 6h
		// sent as a number, a repeated --secrets as an array, -v as an object.
		const jobs: OpenAiTool = {
			type: "function",
			function: {
				name: "hf_jobs",
				parameters: { type: "object", properties: { args: { type: "object" } } },
			},
		};
		const [repaired] = withRepairedToolSchemas([jobs], mapping("hf_jobs", "hf_jobs"), HUB);
		const args = (
			repaired.function.parameters?.properties as Record<string, { description: string }>
		).args.description;

		expect(args).toContain('"image"');
		expect(args).toContain('"command"');
		expect(args).toContain("never a number");
		expect(args).toContain("never an array");
		expect(args).toContain("never objects");
		// The docs will keep being CLI-shaped, so the mapping has to be stated.
		expect(args).toContain("hf jobs");
	});

	it("keeps everything else about the schema", () => {
		const [repaired] = withRepairedToolSchemas(
			[sandboxExec()],
			mapping("hf_sandbox_exec", "hf_sandbox_exec"),
			HUB
		);
		const params = repaired.function.parameters as Record<string, unknown>;
		const props = params.properties as Record<string, Record<string, unknown>>;

		expect(params.required).toEqual(["cmd", "args"]);
		expect(params.additionalProperties).toBe(false);
		expect(props.cmd.enum).toEqual(["exec"]);
		expect(props.args.items).toEqual({ type: "string" });
		expect(repaired.function.description).toBe(sandboxExec().function.description);
	});

	it("never mutates the tool it was given — the originals are a shared cache", () => {
		const original = sandboxExec();
		const before = JSON.stringify(original);

		withRepairedToolSchemas([original], mapping("hf_sandbox_exec", "hf_sandbox_exec"), HUB);

		expect(JSON.stringify(original)).toBe(before);
	});

	it("leaves a tool with no repair exactly as it was", () => {
		const other: OpenAiTool = {
			type: "function",
			function: {
				name: "web_search_exa",
				parameters: { properties: { query: { type: "string" } } },
			},
		};
		const [out] = withRepairedToolSchemas(
			[other],
			mapping("web_search_exa", "web_search_exa"),
			HUB
		);

		expect(out).toBe(other);
	});

	it("does not invent a property the server stopped advertising", () => {
		// A repair naming `cmd` must not reintroduce it once the Hub drops it,
		// or the model is told to send something the server will reject.
		const renamed: OpenAiTool = {
			type: "function",
			function: {
				name: "hf_sandbox_exec",
				parameters: { type: "object", properties: { args: { type: "array" } } },
			},
		};
		const [out] = withRepairedToolSchemas(
			[renamed],
			mapping("hf_sandbox_exec", "hf_sandbox_exec"),
			HUB
		);
		const props = out.function.parameters?.properties as Record<string, unknown>;

		expect(Object.keys(props)).toEqual(["args"]);
	});

	it("leaves a same-named tool on another server alone", () => {
		// A user-configured server may export its own hf_sandbox_exec. Teaching the
		// model the Hub's grammar for it would produce malformed calls, so the
		// repair keys on where the tool came from, not on what it is called.
		const elsewhere: McpServerConfig[] = [{ name: "Other", url: "https://other.test/mcp" }];
		const [out] = withRepairedToolSchemas(
			[sandboxExec()],
			{ hf_sandbox_exec: { fnName: "hf_sandbox_exec", server: "Other", tool: "hf_sandbox_exec" } },
			elsewhere
		);

		expect(out).toBe(sandboxExec.call(null) && out);
		expect(
			(out.function.parameters?.properties as Record<string, { description: string }>).cmd
				.description
		).toBe("Command to execute.");
	});

	it("ignores a tool the mapping does not cover", () => {
		const [out] = withRepairedToolSchemas([sandboxExec()], {}, HUB);
		expect(out).toEqual(sandboxExec());
	});
});
