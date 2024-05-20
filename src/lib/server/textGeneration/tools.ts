import { ToolResultStatus, type ToolCall, type ToolResult } from "$lib/types/Tool";
import { v4 as uuidV4 } from "uuid";
import JSON5 from "json5";
import type { BackendTool } from "../tools";
import {
	MessageToolUpdateType,
	MessageUpdateStatus,
	MessageUpdateType,
	type MessageUpdate,
} from "$lib/types/MessageUpdate";
import type { TextGenerationContext } from "./types";

import { allTools } from "../tools";
import directlyAnswer from "../tools/directlyAnswer";
import websearch from "../tools/web/search";
import { z } from "zod";

export function pickTools(
	toolsPreference: Record<string, boolean>,
	isAssistant: boolean
): BackendTool[] {
	// if it's an assistant, only support websearch for now
	if (isAssistant) return [directlyAnswer, websearch];

	// filter based on tool preferences, add the tools that are on by default
	return allTools.filter((el) => {
		if (el.isLocked && el.isOnByDefault) return true;
		return toolsPreference?.[el.name] ?? el.isOnByDefault;
	});
}

export async function* runTools(
	{ endpoint, conv, messages, assistant }: TextGenerationContext,
	tools: BackendTool[],
	preprompt?: string
): AsyncGenerator<MessageUpdate, ToolResult[], undefined> {
	const calls: ToolCall[] = [];

	// do the function calling bits here
	for await (const output of await endpoint({
		messages,
		preprompt,
		generateSettings: assistant?.generateSettings,
		tools,
	})) {
		// model natively supports tool calls
		if (output.token.toolCalls) {
			calls.push(...output.token.toolCalls);
			continue;
		}

		// look for a code blocks of ```json and parse them
		// if they're valid json, add them to the calls array
		if (output.generated_text) {
			const codeBlocks = Array.from(output.generated_text.matchAll(/```json\n(.*?)```/gs));
			if (codeBlocks.length === 0) continue;

			// grab only the capture group from the regex match
			for (const [, block] of codeBlocks) {
				try {
					calls.push(...JSON5.parse(block).filter(isExternalToolCall).map(externalToToolCall));
				} catch (cause) {
					// error parsing the calls
					yield {
						type: MessageUpdateType.Status,
						status: MessageUpdateStatus.Error,
						message: cause instanceof Error ? cause.message : String(cause),
					};
				}
			}
		}
	}

	const toolResults: ToolResult[] = [];
	for (const call of calls) {
		const uuid = uuidV4();

		const tool = tools.find((el) => el.name === call.name);

		if (!tool) {
			toolResults.push({ call, status: ToolResultStatus.Error, message: "Could not find tool" });
			continue;
		}
		// Special case for directly_answer tool where we ignore
		if (tool.name === "directly_answer") continue;

		yield {
			type: MessageUpdateType.Tool,
			subtype: MessageToolUpdateType.Call,
			uuid,
			call,
		};
		try {
			const toolResult = yield* tool.call(call.parameters, {
				conv,
				messages,
				preprompt,
				assistant,
			});
			yield {
				type: MessageUpdateType.Tool,
				subtype: MessageToolUpdateType.Result,
				uuid,
				result: { ...toolResult, call } as ToolResult,
			};
			toolResults.push({ ...toolResult, call } as ToolResult);
		} catch (cause) {
			console.error(Error(`Failed while running tool ${call.name}`), { cause });
			toolResults.push({
				call,
				status: ToolResultStatus.Error,
				message: cause instanceof Error ? cause.message : String(cause),
			});
		}
	}

	return toolResults;
}

const externalToolCall = z.object({
	tool_name: z.string(),
	parameters: z.record(z.any()),
});
type ExternalToolCall = z.infer<typeof externalToolCall>;
function isExternalToolCall(call: unknown): call is ExternalToolCall {
	return externalToolCall.safeParse(call).success;
}

function externalToToolCall(call: ExternalToolCall): ToolCall {
	const tool = allTools.find((el) => el.name === call.tool_name);
	if (tool === undefined) {
		throw new Error(`Could not find tool ${call.tool_name}`);
	}

	const parametersWithDefaults = Object.fromEntries(
		Object.entries(tool.parameterDefinitions).map(([key, definition]) => {
			const value = call.parameters[key];

			// Required so ensure it's there
			if (definition.required) {
				if (value === undefined) {
					throw new Error(`Missing required parameter ${key} for tool ${call.tool_name}`);
				}
				return [key, value];
			}

			// Optional so use default if not there
			return [key, value ?? definition.default];
		})
	);

	return {
		name: call.tool_name,
		parameters: parametersWithDefaults,
	};
}
