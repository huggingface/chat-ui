import { fromJsonSchema } from "@modelcontextprotocol/client";
import { logger } from "$lib/server/logger";
import type { GuardVerdict, ToolCallGuard } from "$lib/server/textGeneration/mcp/toolGuard";
import type { McpToolMapping } from "./tools";

/**
 * Checks a call's arguments against the tool's own schema before it is sent.
 *
 * Nothing else on the outbound path does: the MCP client SDK compiles a
 * validator for a tool's `outputSchema` and sends `arguments` untouched, and
 * providers were observed passing through arguments that violate a declared
 * `additionalProperties: false`. The server is the only validator in the chain,
 * so a malformed call costs a network round trip and — far more expensive — the
 * model round spent re-prefilling a long context to correct it.
 *
 * Deliberately enforces only what the schema literally states. Being stricter
 * than the server anywhere would refuse calls that would have worked, with no
 * way for the model to find out otherwise, so every uncertainty here resolves
 * to allowing the call: no schema, a schema that will not compile, a validator
 * that throws.
 */

type Validate = (args: Record<string, unknown>) => string | undefined;

/** Compiles once per tool. `undefined` means "cannot check this one — allow it". */
function compile(schema: Record<string, unknown>): Validate | undefined {
	try {
		const standard = fromJsonSchema(schema) as unknown as {
			"~standard": { validate: (value: unknown) => unknown };
		};
		const validate = standard?.["~standard"]?.validate;
		if (typeof validate !== "function") return undefined;
		return (args) => {
			try {
				const result = validate(args);
				// The SDK's validator is synchronous. A promise would mean a validator
				// this was not written against, and awaiting it here is not possible.
				if (typeof (result as { then?: unknown })?.then === "function") return undefined;
				const issues = (result as { issues?: Array<{ message?: string }> })?.issues;
				if (!issues?.length) return undefined;
				return issues
					.map((issue) => issue.message)
					.filter(Boolean)
					.join("; ");
			} catch {
				return undefined;
			}
		};
	} catch (err) {
		logger.debug({ err: String(err) }, "[mcp] tool schema would not compile; preflight skipped");
		return undefined;
	}
}

export function createSchemaPreflightGuard(mapping: Record<string, McpToolMapping>): ToolCallGuard {
	const compiled = new Map<string, Validate | undefined>();

	return {
		// Holds nothing between before and after — see composeGuards.
		allowParking: true,

		async before(call): Promise<GuardVerdict> {
			const schema = mapping[call.fnName]?.inputSchema;
			if (!schema) return { allow: true, ticket: call.fnName };

			if (!compiled.has(call.fnName)) compiled.set(call.fnName, compile(schema));
			const problem = compiled.get(call.fnName)?.(call.args);
			if (!problem) return { allow: true, ticket: call.fnName };

			logger.debug(
				{ tool: call.tool, problem },
				"[mcp] arguments fail the tool's own schema; not dispatched"
			);
			return {
				allow: false,
				message:
					`${call.tool} was not called: these arguments do not match the schema it publishes — ${problem}. ` +
					`Nothing was sent to the server. Re-read this tool's parameters and call it again with arguments that fit them.`,
			};
		},

		async after() {
			return undefined;
		},
	};
}
