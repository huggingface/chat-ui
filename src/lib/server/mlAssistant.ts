import type { Conversation } from "$lib/types/Conversation";
import type { McpServerConfig } from "./mcp/httpClient";
import { hasAuthHeader, isHfMcpServer } from "./mcp/hf";
import { getMcpServers } from "./mcp/registry";
import { ML_ASSISTANT_MODE } from "$lib/utils/mlAssistantFlag";
import type { HubBillingTarget } from "$lib/server/mcp/hubBilling";
import { billingTarget } from "$lib/server/billing";

/**
 * The ML Assistant preset: the tools and capabilities a conversation gets when it
 * was started in the mode. Its model-facing text lives in `./mlAssistantPrompt`.
 *
 * Everything here is fixed. The prompt deliberately replaces the user's per-model
 * custom prompt rather than composing with it — the preset is a mode, not a
 * suggestion — and the servers below are unioned into whatever the user has
 * selected, so extra servers still work but the preset's cannot be turned off.
 *
 * Resolved per generation rather than frozen onto the conversation at creation,
 * so editing the preset reaches conversations that already exist.
 */

/**
 * The Hub MCP server's tool preset for the mode (hf-mcp-server >= 0.4.18):
 * filesystem read and write, sandboxes, jobs, repo details, create_repo and
 * whoami — no repo search, no dynamic Space. Resolved server-side on every
 * request, so the URL keeps tracking the preset as it changes.
 */
const ML_ASSISTANT_HF_BOUQUET = "intern";

/**
 * `login` stays alongside the bouquet: `isStrictHfMcpLogin` keys on it, and it
 * is what gates both the user's HF token being forwarded to the server and the
 * login control on the server card. Without it the mode's Hub tools run
 * anonymously — no whoami, no jobs, no writes — and because the preset wins the
 * name collision, it would override the correctly configured entry that prod
 * and dev already ship rather than merely getting itself wrong.
 */
export const ML_ASSISTANT_HF_MCP_URL = `https://huggingface.co/mcp?login&bouquet=${ML_ASSISTANT_HF_BOUQUET}`;

/**
 * MCP servers always available in the mode. Merged over the user's selection by
 * name, so a same-named entry of theirs cannot shadow one of these.
 */
export const ML_ASSISTANT_MCP_SERVERS: McpServerConfig[] = [
	{ name: "Hugging Face", url: ML_ASSISTANT_HF_MCP_URL },
];

/**
 * A pinned entry outranks the preset for its credential, not its tool set: the
 * mode still runs on the intern bouquet unless the operator chose one of their
 * own.
 */
function withMlAssistantBouquet(url: string): string {
	const u = new URL(url);
	if (u.searchParams.has("bouquet")) return url;
	u.searchParams.set("bouquet", ML_ASSISTANT_HF_BOUQUET);
	return u.toString();
}

/**
 * Whether this conversation runs under the preset. Gated on the build flag too,
 * so a build that doesn't ship the mode ignores the field even if the database
 * carries it from a build that did.
 */
export function isMlAssistantConversation(conv: Pick<Conversation, "mlAssistant">): boolean {
	return ML_ASSISTANT_MODE && conv.mlAssistant === true;
}

/**
 * The Bearer token of an operator-pinned Hub MCP entry, if one is configured.
 * When such an entry wins the preset merge, jobs launch under it rather than
 * the user's token — so settlement must query the Jobs API as the same
 * account, or traceable holds either never resolve (no user token) or 404 as
 * the wrong account and get charged at their full ceiling.
 */
export function pinnedHubToken(): string | undefined {
	for (const server of withMlAssistantServers(getMcpServers())) {
		if (!isHfMcpServer(server.url) || !hasAuthHeader(server.headers)) continue;
		const raw = Object.entries(server.headers ?? {}).find(
			([key]) => key.toLowerCase() === "authorization"
		)?.[1];
		const match = raw ? /^Bearer\s+(\S+)$/i.exec(raw) : null;
		if (match) return match[1];
	}
	return undefined;
}

/**
 * The organisation this request's Hub compute is billed to, if any.
 *
 * Deliberately blind to how the Hub server authenticates. An operator-pinned
 * token may or may not belong to the organisation the user picked, and a guess
 * is wrong in one direction or the other: a namespace the credential cannot
 * write to fails loudly at submission, where a suppressed setting bills the
 * wrong account in silence. The Hub is the authority on the first; only the
 * setting can prevent the second.
 */
export function mlAssistantBillingNamespace(
	locals: { billingOrganization?: string } | undefined
): string | undefined {
	return billingTarget(locals)?.organization;
}

/** Trusted Jobs/Sandbox payer selected in the user's settings. */
export function mlAssistantBillingTarget(
	locals: { billingOrganization?: string; billingResourceGroup?: string } | undefined
): HubBillingTarget | undefined {
	const target = billingTarget(locals);
	if (!target) return undefined;
	return {
		namespace: target.organization,
		...(target.resourceGroupId ? { resourceGroupId: target.resourceGroupId } : {}),
	};
}

/**
 * The target this request's Hub compute runs under and is charged to: the
 * billing organisation, with its resource group when one is selected, else the
 * user's own account.
 *
 * Personal is a choice too. Without a namespace of its own to enforce, a run
 * the model addressed to some organisation would go through and charge an
 * account the user never picked.
 */
export function mlAssistantPayerTarget(
	locals:
		| { billingOrganization?: string; billingResourceGroup?: string; user?: { username?: string } }
		| undefined
): HubBillingTarget | undefined {
	const selected = mlAssistantBillingTarget(locals);
	if (selected) return selected;
	const username = locals?.user?.username?.trim();
	return username ? { namespace: username } : undefined;
}

/**
 * The preset's servers plus the ones already resolved for this request, preset
 * first. Deduplicated by name with the preset winning.
 */
export function withMlAssistantServers(servers: McpServerConfig[]): McpServerConfig[] {
	// Seeded with the preset rather than overwriting later: Map#set keeps an
	// existing key's position, so merging the other way round would leave a
	// preset server wherever the user's same-named entry happened to sit.
	const byName = new Map<string, McpServerConfig>(
		ML_ASSISTANT_MCP_SERVERS.map((server) => [server.name, server])
	);
	for (const server of servers) {
		const preset = byName.get(server.name);
		if (!preset) {
			byName.set(server.name, server);
			continue;
		}
		// An operator-configured entry that still points at the Hub MCP and
		// carries its own Authorization header outranks the preset's `?login`
		// variant: OAuth deployments whose app cannot request the privileged
		// scopes (read-mcp is official-apps-only) pin a token this way, and the
		// forwarding overlay never overrides an explicit header anyway. The URL
		// check stays load-bearing — a same-named entry pointing anywhere else
		// still cannot shadow the preset, authed or not.
		if (hasAuthHeader(server.headers) && isHfMcpServer(server.url)) {
			byName.set(server.name, { ...server, url: withMlAssistantBouquet(server.url) });
		}
	}
	return [...byName.values()];
}
