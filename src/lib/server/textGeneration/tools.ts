import { ToolResultStatus, type ToolCall, type ToolResult } from "$lib/types/Tool";
import { v4 as uuidV4 } from "uuid";
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
import { extractJson, toolHasName } from "../tools/utils";
import type { MessageFile } from "$lib/types/Message";
import { mergeAsyncGenerators } from "$lib/utils/mergeAsyncGenerators";
import { MetricsServer } from "../metrics";
import { stringifyError } from "$lib/utils/stringifyError";

function makeFilesPrompt(files: MessageFile[], fileMessageIndex: number): string {
	if (files.length === 0) {
		return "The user has not uploaded any files. Do not attempt to use any tools that require files";
	}

	const stringifiedFiles = files
		.map(
			(file, fileIndex) =>
				`  - fileMessageIndex ${fileMessageIndex} | fileIndex ${fileIndex} | ${file.name} (${file.mime})`
		)
		.join("\n");
	return `Attached ${files.length} file${files.length === 1 ? "" : "s"}:\n${stringifiedFiles}`;
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

async function* callTool(
	ctx: BackendToolContext,
	tools: BackendTool[],
	call: ToolCall
): AsyncGenerator<MessageUpdate, ToolResult | undefined, undefined> {
	const uuid = uuidV4();

	const tool = tools.find((el) => toolHasName(call.name, el));
	if (!tool) {
		return { call, status: ToolResultStatus.Error, message: `Could not find tool "${call.name}"` };
	}

	// Special case for directly_answer tool where we ignore
	if (toolHasName(directlyAnswer.name, tool)) return;

	const startTime = Date.now();
	MetricsServer.getMetrics().tool.toolUseCount.inc({ tool: call.name });

	yield {
		type: MessageUpdateType.Tool,
		subtype: MessageToolUpdateType.Call,
		uuid,
		call,
	};

	try {
		const toolResult = yield* tool.call(call.parameters, ctx);

		yield {
			type: MessageUpdateType.Tool,
			subtype: MessageToolUpdateType.Result,
			uuid,
			result: { ...toolResult, call } as ToolResult,
		};

		MetricsServer.getMetrics().tool.toolUseDuration.observe(
			{ tool: call.name },
			Date.now() - startTime
		);

		return { ...toolResult, call } as ToolResult;
	} catch (error) {
		MetricsServer.getMetrics().tool.toolUseCountError.inc({ tool: call.name });
		logger.error(error, `Failed while running tool ${call.name}. ${stringifyError(error)}`);

		yield {
			type: MessageUpdateType.Tool,
			subtype: MessageToolUpdateType.Error,
			uuid,
			message: "Error occurred",
		};

		return {
			call,
			status: ToolResultStatus.Error,
			message: "Error occurred",
		};
	}
}

export async function* runTools(
	ctx: TextGenerationContext,
	tools: BackendTool[],
	preprompt?: string
): AsyncGenerator<MessageUpdate, ToolResult[], undefined> {
	const { endpoint, conv, messages, assistant, ip, username } = ctx;
	const calls: ToolCall[] = [];

	const messagesWithFilesPrompt = messages.map((message, idx) => {
		if (!message.files?.length) return message;
		return {
			...message,
			content: `${message.content}\n${makeFilesPrompt(message.files, idx)}`,
		};
	});

	const pickToolStartTime = Date.now();

	// do the function calling bits here
	for await (const output of await endpoint({
		messages: messagesWithFilesPrompt,
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
			try {
				const rawCalls = await extractJson(output.generated_text);
				const newCalls = rawCalls
					.filter(isExternalToolCall)
					.map(externalToToolCall)
					.filter((call) => call !== undefined) as ToolCall[];

				calls.push(...newCalls);
			} catch (e) {
				logger.error(e, "Error while parsing tool calls, please retry");
				// error parsing the calls
				yield {
					type: MessageUpdateType.Status,
					status: MessageUpdateStatus.Error,
					message: "Error while parsing tool calls, please retry",
				};
			}
		}
	}

	MetricsServer.getMetrics().tool.timeToChooseTools.observe(
		{ model: conv.model },
		Date.now() - pickToolStartTime
	);

	const toolContext: BackendToolContext = { conv, messages, preprompt, assistant, ip, username };
	const toolResults: (ToolResult | undefined)[] = yield* mergeAsyncGenerators(
		calls.map((call) => callTool(toolContext, tools, call))
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
