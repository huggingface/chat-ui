import { isHfMcpServer } from "./hf";
import type { McpServerConfig } from "./httpClient";
import type { McpToolMapping, OpenAiTool } from "./tools";

/**
 * Rewrites of advertised parameter descriptions for Hub tools whose schema is
 * thinner than their real interface.
 *
 * Five of them (`hf_sandbox*`, `hf_fs*`) declare two properties — a `cmd`
 * selector and an opaque `args: string[]` — and carry their actual grammar as
 * prose in the tool description. A validator can check neither the grammar nor
 * the order, so every mistake becomes a round trip. Across four ML Intern runs
 * (473 calls, 42 rejections) the two largest classes were both this shape:
 * 8 calls put the shell command in `cmd`, whose only legal value is the literal
 * "exec", and 3 sent `timeout` as a top-level key because the sibling `hf_jobs`
 * takes exactly that.
 *
 * Descriptions are the only lever here — the schemas belong to the Hub's MCP
 * server, and `additionalProperties: false` is already set on the tools that
 * bounced, so the provider is not enforcing it either. Rewriting them is
 * strictly additive: nothing about what the server accepts changes, so a repair
 * that stops being true degrades to noise rather than to a broken call.
 */

/** Keyed by tool name as the server knows it, then by property. */
const PROPERTY_DESCRIPTIONS: Record<string, Record<string, string>> = {
	hf_sandbox_exec: {
		cmd: 'Always the literal "exec" — a selector, not the command you want to run. The shell command is an element of `args`.',
		args: 'Grammar tokens, one per array element — never one joined string: ["exec", "<handle>", "<shell command>", "--timeout", "55"]. Options are tokens too: the execution timeout is the pair `--timeout 55` inside this array (30s default, 55s ceiling), never a top-level property. `hf_jobs` is the tool whose `args` is an object; this one is a list.',
	},
	hf_sandbox: {
		cmd: "Which sandbox operation to run. The handle and every option belong in `args`.",
		args: 'Grammar tokens, one per array element: ["create", "--flavor", "cpu-basic", "--timeout", "1h"]. The sandbox lifetime is the token pair `--timeout <duration>` here, not a top-level property.',
	},
	hf_sandbox_fs: {
		cmd: "Which file operation to run. The handle, the path and every option belong in `args`.",
		args: 'Grammar tokens, one per array element: ["cat", "<handle>", "/data/train.py", "--max-bytes", "80000"]. The handle comes before the path.',
	},
	hf_fs_write: {
		cmd: "Which write operation to run. The URI and every option belong in `args`; file data goes in `content`, not here.",
		args: 'Grammar tokens, one per array element: ["put", "hf://models/<owner>/<name>/README.md", "-m", "<message>"].',
	},
	hf_jobs: {
		args: 'Arguments for this operation as a JSON object — the one Hub tool that takes an object rather than a token list. Submission keys the API requires: `timeout` as a duration string ("20m"), `secrets` as an object, `flavor`, and for `uv` a `script`.',
	},
};

/**
 * The advertised tools with those descriptions applied. Returns fresh objects —
 * the originals come from a shared cache and must not be mutated — and leaves
 * any tool without a repair untouched, identity included.
 *
 * Companion to `withRequiredDiscriminators` in `mlBudget/guard.ts`, which
 * repairs the same schemas for a different reason: the budget gate cannot price
 * a call whose discriminator is missing.
 */
export function withRepairedToolSchemas(
	tools: OpenAiTool[],
	mapping: Record<string, McpToolMapping>,
	servers: McpServerConfig[]
): OpenAiTool[] {
	// A tool name is not proof of where it came from: a user-configured server is
	// free to export its own `hf_jobs`, and rewriting its description with the
	// Hub's grammar would teach the model to call it wrongly.
	const hubServerNames = new Set(
		servers.filter((server) => isHfMcpServer(server.url)).map((server) => server.name)
	);
	return tools.map((tool) => {
		const entry = mapping[tool.function.name];
		const serverTool = entry && hubServerNames.has(entry.server) ? entry.tool : undefined;
		const repairs = serverTool ? PROPERTY_DESCRIPTIONS[serverTool] : undefined;
		const parameters = tool.function.parameters;
		if (!repairs || !parameters) return tool;

		const properties = parameters.properties;
		if (!properties || typeof properties !== "object") return tool;

		// Only properties the server actually advertises: a repair naming one that
		// has since been renamed away must not reintroduce it as a phantom.
		const entries = Object.entries(repairs).filter(
			([name]) => (properties as Record<string, unknown>)[name] !== undefined
		);
		if (entries.length === 0) return tool;

		const repaired: Record<string, unknown> = { ...(properties as Record<string, unknown>) };
		for (const [name, description] of entries) {
			repaired[name] = { ...(repaired[name] as Record<string, unknown>), description };
		}
		return {
			...tool,
			function: { ...tool.function, parameters: { ...parameters, properties: repaired } },
		};
	});
}
