import type { ObjectId } from "mongodb";
import { logger } from "$lib/server/logger";
import { callMcpTool, getMcpToolTimeoutMs } from "./httpClient";
import { getMcpServers } from "./registry";
import { openDurableElicitation, takeResumableElicitation } from "./elicitation";
import { ToolResultStatus } from "$lib/types/Tool";
import {
	MessageElicitationUpdateType,
	MessageToolUpdateType,
	MessageUpdateType,
} from "$lib/types/MessageUpdate";
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
	generationId,
	extraServers = [],
	signal,
}: {
	conversationId: ObjectId;
	elicitationId: string;
	generationId?: string;
	extraServers?: McpServerConfig[];
	signal?: AbortSignal;
}): Promise<{
	resumed: boolean;
	reason?: string;
	updates: MessageUpdate[];
	/** The tool asked something else; the run ends again until that is answered too. */
	parkedAgain?: boolean;
}> {
	const taken = await takeResumableElicitation(conversationId, elicitationId);
	const pending = taken?.row.pending;
	if (!taken || !pending) {
		return { resumed: false, reason: "no answered prompt to resume", updates: [] };
	}
	const { inputResponses } = taken;

	// Nothing emitted this while the run was over, so the transcript still shows an open
	// form. Settling it here is what lets a reloaded page render the answer instead.
	const settled: MessageUpdate = {
		type: MessageUpdateType.Elicitation,
		subtype: MessageElicitationUpdateType.Resolved,
		elicitationId,
		action: taken.row.action ?? "cancel",
		resolution: "user",
		...(taken.row.content ? { content: taken.row.content } : {}),
	};

	const server = [...getMcpServers(), ...extraServers].find((s) => s.name === pending.server);
	if (!server) return { resumed: false, reason: `unknown server ${pending.server}`, updates: [] };

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

		// A tool can ask more than once. Park again on the same call rather than handing
		// the model a round that never finished.
		if (response.inputRequired) {
			const collected: MessageUpdate[] = [];
			const opened = await openDurableElicitation({
				sink: {
					conversationId,
					...(generationId ? { generationId } : {}),
					emit: (u) => collected.push(u),
				},
				server: pending.server,
				toolUuid: pending.toolUuid,
				pending: {
					tool: pending.tool,
					args: pending.args,
					messageId: pending.messageId,
					toolCallId: pending.toolCallId,
					toolUuid: pending.toolUuid,
				},
				inputRequired: response.inputRequired,
			});
			if (opened.opened) {
				return { resumed: true, updates: [settled, ...collected], parkedAgain: true };
			}
			return {
				resumed: false,
				reason: `could not show the next prompt: ${opened.reason}`,
				updates: [settled],
			};
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

	return { resumed: true, updates: [settled, update] };
}
