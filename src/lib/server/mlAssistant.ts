import type { Conversation } from "$lib/types/Conversation";
import type { McpServerConfig } from "./mcp/httpClient";
import { ML_ASSISTANT_MODE } from "$lib/utils/mlAssistantFlag";

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
 * MCP servers always available in the mode. Merged over the user's selection by
 * name, so a same-named entry of theirs cannot shadow one of these.
 *
 * The `?login` endpoint, not the bare one: `isStrictHfMcpLogin` matches on the
 * exact URL, and it is what gates both the user's HF token being forwarded to
 * the server and the login control on the server card. Without it the mode's
 * Hub tools run anonymously — no whoami, no jobs, no writes — and because the
 * preset wins the name collision, it would override the correctly configured
 * entry that prod and dev already ship rather than merely getting itself wrong.
 */
export const ML_ASSISTANT_MCP_SERVERS: McpServerConfig[] = [
	{ name: "Hugging Face", url: "https://hf.co/mcp?login" },
];

/**
 * Whether this conversation runs under the preset. Gated on the build flag too,
 * so a build that doesn't ship the mode ignores the field even if the database
 * carries it from a build that did.
 */
export function isMlAssistantConversation(conv: Pick<Conversation, "mlAssistant">): boolean {
	return ML_ASSISTANT_MODE && conv.mlAssistant === true;
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
		if (!byName.has(server.name)) byName.set(server.name, server);
	}
	return [...byName.values()];
}
