import type { ObjectId } from "mongodb";
import { logger } from "$lib/server/logger";
import { callMcpTool, getMcpToolTimeoutMs } from "./httpClient";
import { getMcpServers } from "./registry";
import { takeResumableElicitation } from "./elicitation";
import { ToolResultStatus } from "$lib/types/Tool";
import { MessageToolUpdateType, MessageUpdateType } from "$lib/types/MessageUpdate";
import type { MessageUpdate } from "$lib/types/MessageUpdate";
import type { McpServerConfig } from "./httpClient";

/**
 * Re-issue the tool call a durable prompt parked, now that it has an answer.
 *
 * The 2026-era server kept no state — `requestState` and the answers are the whole
 * continuation — so this runs anywhere, on any connection, however long afterwards.
 * Returns the update rather than writing it: the caller feeds it through the run's normal
 * update path, so it streams, persists, and lands in the writer's snapshot together —
 * writing it separately would be overwritten by the next materialise.
 */
export async function resumeParkedToolCall({
	conversationId,
	elicitationId,
	extraServers = [],
	signal,
}: {
	conversationId: ObjectId;
	elicitationId: string;
	extraServers?: McpServerConfig[];
	signal?: AbortSignal;
}): Promise<{ resumed: boolean; reason?: string; update?: MessageUpdate }> {
	const taken = await takeResumableElicitation(conversationId, elicitationId);
	const pending = taken?.row.pending;
	if (!taken || !pending) return { resumed: false, reason: "no answered prompt to resume" };
	const { inputResponses } = taken;

	const server = [...getMcpServers(), ...extraServers].find((s) => s.name === pending.server);
	if (!server) return { resumed: false, reason: `unknown server ${pending.server}` };

	let update: MessageUpdate;
	try {
		const response = await callMcpTool(server, pending.tool, pending.args, {
			signal,
			timeoutMs: getMcpToolTimeoutMs(),
			resume: {
				inputResponses,
				...(pending.requestState !== undefined ? { requestState: pending.requestState } : {}),
			},
		});

		// A second prompt in the same call is a second round; this pass answers one.
		if (response.inputRequired) {
			return { resumed: false, reason: "the tool asked for more input" };
		}

		update = response.isError
			? {
					type: MessageUpdateType.Tool,
					subtype: MessageToolUpdateType.Error,
					uuid: pending.toolUuid,
					message: response.text || "The tool reported an error with no message.",
				}
			: {
					type: MessageUpdateType.Tool,
					subtype: MessageToolUpdateType.Result,
					uuid: pending.toolUuid,
					result: {
						status: ToolResultStatus.Success,
						call: { name: pending.tool, parameters: {} },
						outputs: [
							{
								text: response.text ?? "",
								structured: response.structured,
								content: response.content,
							},
						] as unknown as Record<string, unknown>[],
						display: true,
					},
				};
	} catch (err) {
		logger.warn({ err, tool: pending.tool }, "[mcp] resumed tool call failed");
		update = {
			type: MessageUpdateType.Tool,
			subtype: MessageToolUpdateType.Error,
			uuid: pending.toolUuid,
			message: err instanceof Error ? err.message : String(err),
		};
	}

	return { resumed: true, update };
}
