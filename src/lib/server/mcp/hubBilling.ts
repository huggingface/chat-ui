import { logger } from "$lib/server/logger";
import { isHfMcpServer } from "./hf";
import type { ToolArgsRewrite } from "$lib/server/textGeneration/mcp/toolInvocation";

/**
 * Bills the Hub compute a conversation launches to the user's billing
 * organisation.
 *
 * Not a header: inference takes `X-HF-Bill-To`, but a job is charged to the
 * namespace it is created under, and the Hub MCP server forwards nothing from
 * the transport to the Jobs API. The namespace is an argument — `namespace` on
 * every hf_jobs operation, `--namespace` on hf_sandbox create — defaulting to
 * the signed-in user when absent.
 *
 * Submissions are overwritten, reads are filled in. Who pays is the user's
 * setting, not the model's call. A read may legitimately name somewhere else:
 * a job launched before the setting changed lives under the user, and its URL
 * says so. Filling in a read that names none is also what lets `check_job` find
 * the org's jobs from a bare id.
 */

/** hf_jobs operations that create a job, and so decide who is charged for it. */
const SUBMITTING_OPERATIONS = new Set(["run", "uv", "scheduled run", "scheduled uv"]);

export interface HubBillingTarget {
	namespace: string;
	resourceGroupId?: string;
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
	typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;

const namesNamespace = (value: unknown): value is string =>
	typeof value === "string" && value.trim().length > 0;

function withJobsNamespace(
	args: Record<string, unknown>,
	target: HubBillingTarget
): Record<string, unknown> {
	const { namespace, resourceGroupId } = target;
	// Without an operation the budget gate refuses the call; leave it whole so
	// the refusal describes what the model actually sent.
	if (typeof args.operation !== "string") return args;
	// An absent `args` is an empty object to the server. Anything else that is
	// not an object fails the tool's own schema, and the preflight should say so.
	const inner = args.args === undefined ? {} : asRecord(args.args);
	if (!inner) return args;
	const submitting = SUBMITTING_OPERATIONS.has(args.operation);
	if (!submitting && namesNamespace(inner.namespace)) return args;
	if (submitting && namesNamespace(inner.namespace) && inner.namespace !== namespace) {
		logger.debug(
			{ tool: "hf_jobs", wanted: inner.namespace, namespace },
			"[mcp] billing namespace replaces the model's"
		);
	}
	const rewritten: Record<string, unknown> = { ...inner, namespace };
	if (resourceGroupId) rewritten.resource_group_id = resourceGroupId;
	else delete rewritten.resource_group_id;
	return { ...args, args: rewritten };
}

function withSandboxNamespace(
	args: Record<string, unknown>,
	target: HubBillingTarget
): Record<string, unknown> {
	const { namespace, resourceGroupId } = target;
	// Only create decides who pays: every later command carries a handle that
	// already names the namespace (hfsb2:<namespace>:<id>).
	if (args.cmd !== "create" || !Array.isArray(args.args)) return args;
	// The server's parser takes this option once and rejects a repeat, so every
	// occurrence goes and exactly one comes back.
	const given = args.args as unknown[];
	const tokens: unknown[] = [];
	const wanted: unknown[] = [];
	const wantedResourceGroups: unknown[] = [];
	for (let i = 0; i < given.length; i++) {
		if (given[i] !== "--namespace" && given[i] !== "--resource-group-id") {
			tokens.push(given[i]);
			continue;
		}
		const flag = given[i];
		if (i + 1 < given.length) {
			const value = given[++i];
			if (flag === "--namespace") wanted.push(value);
			else wantedResourceGroups.push(value);
		}
	}
	if (
		wanted.some((value) => namesNamespace(value) && value !== namespace) ||
		wantedResourceGroups.some((value) => namesNamespace(value) && value !== resourceGroupId)
	) {
		logger.debug(
			{ tool: "hf_sandbox", wanted, wantedResourceGroups, namespace, resourceGroupId },
			"[mcp] billing namespace replaces the model's"
		);
	}
	return {
		...args,
		args: [
			...tokens,
			"--namespace",
			namespace,
			...(resourceGroupId ? ["--resource-group-id", resourceGroupId] : []),
		],
	};
}

/** Hub servers only: a custom server may export its own `hf_jobs`, whose namespace is not ours. */
export function createHubBillingRewrite(target: HubBillingTarget): ToolArgsRewrite {
	return ({ serverUrl, tool, args }) => {
		if (!isHfMcpServer(serverUrl)) return args;
		if (tool === "hf_jobs") return withJobsNamespace(args, target);
		if (tool === "hf_sandbox") return withSandboxNamespace(args, target);
		return args;
	};
}
