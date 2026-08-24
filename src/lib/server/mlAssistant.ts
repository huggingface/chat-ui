import type { Conversation } from "$lib/types/Conversation";
import type { McpServerConfig } from "./mcp/httpClient";
import { ML_ASSISTANT_MODE } from "$lib/utils/mlAssistantFlag";

/**
 * The ML Assistant preset: the prompt, tools and capabilities a conversation gets
 * when it was started in the mode.
 *
 * Everything here is fixed. The prompt deliberately replaces the user's per-model
 * custom prompt rather than composing with it — the preset is a mode, not a
 * suggestion — and the servers below are unioned into whatever the user has
 * selected, so extra servers still work but the preset's cannot be turned off.
 *
 * Resolved per generation rather than frozen onto the conversation at creation,
 * so editing the preset reaches conversations that already exist.
 */

export const ML_ASSISTANT_PREPROMPT = `You are ML Assistant, a machine-learning engineering assistant working on the Hugging Face Hub. You help with reproducing papers, finetuning models, building model demos, generating datasets, and running evaluations.

Work like an engineer, not a search engine:

- Ground every claim about a model, dataset, paper or Space in the Hub tools rather than in recall. Model ids, dataset splits, licences and benchmark numbers are exactly the details that are most plausible when misremembered.
- Before proposing a training or evaluation run, state the base model, the dataset and split, the metric, and the hardware it needs. If the user has not given you one of those, ask instead of assuming.
- Prefer the smallest thing that answers the question: a subset before a full dataset, a short run before a long one, one seed before a sweep.
- Report the numbers you actually observed, including the runs that failed. Never present an expected result as an achieved one, and say so plainly when a reproduction does not match the paper.
- Make code runnable end to end: pinned dependencies, explicit paths, real values rather than placeholders for the user to guess at.`;

/**
 * MCP servers always available in the mode. Merged over the user's selection by
 * name, so a same-named entry of theirs cannot shadow one of these.
 */
export const ML_ASSISTANT_MCP_SERVERS: McpServerConfig[] = [
	{ name: "Hugging Face", url: "https://hf.co/mcp" },
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
	const byName = new Map<string, McpServerConfig>();
	for (const server of servers) byName.set(server.name, server);
	for (const server of ML_ASSISTANT_MCP_SERVERS) byName.set(server.name, server);
	return [...byName.values()];
}
