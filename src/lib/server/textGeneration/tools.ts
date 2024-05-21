import { ToolResultStatus, type ToolCall, type ToolResult } from "$lib/types/Tool";
import { v4 as uuidV4 } from "uuid";
import JSON5 from "json5";
import type { BackendTool, BackendToolContext } from "../tools";
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
import { logger } from "../logger";
import { toolHasName } from "../tools/utils";
import type { MessageFile } from "$lib/types/Message";
import { mergeAsyncGenerators } from "$lib/utils/mergeAsyncGenerators";

function makeFilesPrompt(files: MessageFile[]): string {
	if (files.length === 0) return "";

	const stringifiedFiles = files
		.map((file, idx) => `  - fileIndex ${idx} | ${file.name} (${file.mime})`)
		.join("\n");
	return `The user attached ${files.length} file${
		files.length === 1 ? "" : "s"
	}:\n${stringifiedFiles}`;
}

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

async function* runTool(
	{ conv, messages, preprompt, assistant }: BackendToolContext,
	tools: BackendTool[],
	call: ToolCall
): AsyncGenerator<MessageUpdate, ToolResult | undefined, undefined> {
	const uuid = uuidV4();

	const tool = tools.find((el) => el.name === call.name);
	if (!tool) {
		return { call, status: ToolResultStatus.Error, message: `Could not find tool "${call.name}"` };
	}

	// Special case for directly_answer tool where we ignore
	if (toolHasName(directlyAnswer.name, tool)) return;

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
		return { ...toolResult, call } as ToolResult;
	} catch (cause) {
		console.error(Error(`Failed while running tool ${call.name}`), { cause });
		return {
			call,
			status: ToolResultStatus.Error,
			message: cause instanceof Error ? cause.message : String(cause),
		};
	}
}

export async function* runTools(
	{ endpoint, conv, messages, assistant }: TextGenerationContext,
	tools: BackendTool[],
	preprompt?: string
): AsyncGenerator<MessageUpdate, ToolResult[], undefined> {
	const calls: ToolCall[] = [];

	// inform the model if there are files attached
	const userMessage = messages.find((message) => message.from === "user");
	preprompt = `${preprompt ?? ""}\n${makeFilesPrompt(userMessage?.files ?? [])}`.trim();

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
					calls.push(
						...JSON5.parse(block).filter(isExternalToolCall).map(externalToToolCall).filter(Boolean)
					);
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

	const toolContext: BackendToolContext = { conv, messages, preprompt, assistant };
	const toolResults: (ToolResult | undefined)[] = yield* mergeAsyncGenerators(
		calls.map((call) => runTool(toolContext, tools, call))
	);
	return toolResults.filter((result): result is ToolResult => result !== undefined);
}

const externalToolCall = z.object({
	tool_name: z.string(),
	parameters: z.record(z.any()),
});

type ExternalToolCall = z.infer<typeof externalToolCall>;

function isExternalToolCall(call: unknown): call is ExternalToolCall {
	return externalToolCall.safeParse(call).success;
}

function externalToToolCall(call: ExternalToolCall): ToolCall | undefined {
	// Convert - to _ since some models insist on using _ instead of -
	const tool = allTools.find((tool) => toolHasName(call.tool_name, tool));
	if (!tool) {
		logger.debug(`Model requested tool that does not exist: "${call.tool_name}". Skipping tool...`);
		return;
	}

	const parametersWithDefaults: Record<string, string> = {};

	for (const [key, definition] of Object.entries(tool.parameterDefinitions)) {
		const value = call.parameters[key];

		// Required so ensure it's there, otherwise return undefined
		if (definition.required) {
			if (value === undefined) {
				logger.debug(
					`Model requested tool "${call.tool_name}" but was missing required parameter "${key}". Skipping tool...`
				);
				return;
			}
			parametersWithDefaults[key] = value;
			continue;
		}

		// Optional so use default if not there
		parametersWithDefaults[key] = value ?? definition.default;
	}

	return {
		name: call.tool_name,
		parameters: parametersWithDefaults,
	};
}
