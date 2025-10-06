import { randomUUID } from "crypto";
import { logger } from "../../logger";
import type { MessageUpdate } from "$lib/types/MessageUpdate";
import { MessageToolUpdateType, MessageUpdateType } from "$lib/types/MessageUpdate";
import { ToolResultStatus } from "$lib/types/Tool";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { McpToolMapping } from "$lib/server/mcp/tools";
import type { McpServerConfig } from "$lib/server/mcp/httpClient";
import { callMcpTool } from "$lib/server/mcp/httpClient";

export type Primitive = string | number | boolean;

export type ToolRun = {
	name: string;
	parameters: Record<string, Primitive>;
	output: string;
};

export interface NormalizedToolCall {
	id: string;
	name: string;
	arguments: string;
}

export interface ExecuteToolCallsParams {
	calls: NormalizedToolCall[];
	mapping: Record<string, McpToolMapping>;
	servers: McpServerConfig[];
	parseArgs: (raw: unknown) => Record<string, unknown>;
	toPrimitive: (value: unknown) => Primitive | undefined;
	collectToolOutputSources: (text: string) => {
		annotated: string;
		sources: { index: number; link: string }[];
	};
}

export interface ToolCallExecutionResult {
	toolMessages: ChatCompletionMessageParam[];
	toolRuns: ToolRun[];
	finalAnswer?: { text: string; interrupted: boolean };
}

export type ToolExecutionEvent =
	| { type: "update"; update: MessageUpdate }
	| { type: "complete"; summary: ToolCallExecutionResult };

const serverMap = (servers: McpServerConfig[]): Map<string, McpServerConfig> => {
	const map = new Map<string, McpServerConfig>();
	for (const server of servers) {
		if (server?.name) {
			map.set(server.name, server);
		}
	}
	return map;
};

export async function* executeToolCalls({
	calls,
	mapping,
	servers,
	parseArgs,
	toPrimitive,
	collectToolOutputSources,
}: ExecuteToolCallsParams): AsyncGenerator<ToolExecutionEvent, void, undefined> {
	const toolMessages: ChatCompletionMessageParam[] = [];
	const toolRuns: ToolRun[] = [];
	const serverLookup = serverMap(servers);

	for (const call of calls) {
		const mappingEntry = mapping[call.name];
		const uuid = randomUUID();
		const argsObj = parseArgs(call.arguments);
		const parametersClean: Record<string, Primitive> = {};
		for (const [key, value] of Object.entries(argsObj ?? {})) {
			const primitive = toPrimitive(value);
			if (primitive !== undefined) {
				parametersClean[key] = primitive;
			}
		}

		yield {
			type: "update",
			update: {
				type: MessageUpdateType.Tool,
				subtype: MessageToolUpdateType.Call,
				uuid,
				call: { name: call.name, parameters: parametersClean },
			},
		};

		yield {
			type: "update",
			update: {
				type: MessageUpdateType.Tool,
				subtype: MessageToolUpdateType.ETA,
				uuid,
				eta: 10,
			},
		};

		if (!mappingEntry) {
			const message = `Unknown MCP function: ${call.name}`;
			yield {
				type: "update",
				update: {
					type: MessageUpdateType.Tool,
					subtype: MessageToolUpdateType.Error,
					uuid,
					message,
				},
			};
			yield {
				type: "complete",
				summary: {
					toolMessages,
					toolRuns,
					finalAnswer: { text: message, interrupted: false },
				},
			};
			return;
		}

		const serverConfig = serverLookup.get(mappingEntry.server);
		if (!serverConfig) {
			const message = `Unknown MCP server: ${mappingEntry.server}`;
			yield {
				type: "update",
				update: {
					type: MessageUpdateType.Tool,
					subtype: MessageToolUpdateType.Error,
					uuid,
					message,
				},
			};
			yield {
				type: "complete",
				summary: {
					toolMessages,
					toolRuns,
					finalAnswer: { text: message, interrupted: false },
				},
			};
			return;
		}

		try {
			logger.debug(
				{ server: mappingEntry.server, tool: mappingEntry.tool, parameters: parametersClean },
				"[mcp] invoking tool"
			);
			const outputRaw = await callMcpTool(serverConfig, mappingEntry.tool, argsObj);
			const { annotated: output, sources: outputSources } = collectToolOutputSources(outputRaw);
			logger.debug(
				{ server: mappingEntry.server, tool: mappingEntry.tool },
				"[mcp] tool call completed"
			);

			yield {
				type: "update",
				update: {
					type: MessageUpdateType.Tool,
					subtype: MessageToolUpdateType.Result,
					uuid,
					result: {
						status: ToolResultStatus.Success,
						call: { name: call.name, parameters: parametersClean },
						outputs: [
							{
								content: output,
								sources: outputSources,
							},
						],
						display: true,
					},
				},
			};

			toolRuns.push({ name: call.name, parameters: parametersClean, output });
			toolMessages.push({ role: "tool", tool_call_id: call.id, content: output });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			logger.warn(
				{ server: mappingEntry.server, tool: mappingEntry.tool, err: message },
				"[mcp] tool call failed"
			);
			yield {
				type: "update",
				update: {
					type: MessageUpdateType.Tool,
					subtype: MessageToolUpdateType.Error,
					uuid,
					message,
				},
			};
			yield {
				type: "complete",
				summary: {
					toolMessages,
					toolRuns,
					finalAnswer: { text: `MCP error: ${message}`, interrupted: false },
				},
			};
			return;
		}
	}

	yield {
		type: "complete",
		summary: { toolMessages, toolRuns },
	};
}
