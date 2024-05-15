import { ToolResultStatus, type ToolCall, type ToolResult } from "$lib/types/Tool";
import { v4 as uuidV4 } from "uuid";
import JSON5 from "json5";
import type { BackendTool } from "../tools";
import {
	TextGenerationStatus,
	TextGenerationToolUpdateType,
	TextGenerationUpdateType,
	type TextGenerationContext,
	type TextGenerationUpdate,
} from "./types";

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
): AsyncGenerator<TextGenerationUpdate, ToolResult[], undefined> {
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
			console.log(output.generated_text);
			const codeBlocks = output.generated_text.match(/```json\n(.*?)```/gs);
			if (!codeBlocks) continue;

			for (const block of codeBlocks) {
				const trimmedBlock = block.replace("```json\n", "").slice(0, -3);
				try {
					calls.push(
						...JSON5.parse(trimmedBlock).filter(isExternalToolCall).map(externalToToolCall)
					);
				} catch (cause) {
					// error parsing the calls
					yield {
						type: TextGenerationUpdateType.Status,
						status: TextGenerationStatus.Error,
						message: cause instanceof Error ? cause.message : String(cause),
					};
					console.error(cause);
				}
			}
		}
	}

	const toolResults: ToolResult[] = [];
	for (const call of calls) {
		const uuid = uuidV4();

		yield {
			type: TextGenerationUpdateType.Tool,
			subtype: TextGenerationToolUpdateType.Parameters,
			name: call.name,
			parameters: call.parameters,
			uuid,
		};

		const tool = tools.find((el) => el.name === call.name);
		if (!tool) {
			toolResults.push({ call, status: ToolResultStatus.Error, message: "Could not find tool" });
			continue;
		}
		try {
			const toolResult = yield* tool.call(call.parameters, {
				conv,
				messages,
				preprompt,
				assistant,
			});
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
	parameters: z.record(z.string()),
});
type ExternalToolCall = z.infer<typeof externalToolCall>;
function isExternalToolCall(call: unknown): call is ExternalToolCall {
	return externalToolCall.safeParse(call).success;
}

function externalToToolCall(call: ExternalToolCall): ToolCall {
	return {
		name: call.tool_name,
		parameters: call.parameters,
	};
}
