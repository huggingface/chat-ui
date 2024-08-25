import { ToolResultStatus, type ToolCall, type Tool, type ToolResult } from "$lib/types/Tool";
import { v4 as uuidV4 } from "uuid";
import { getCallMethod, toolFromConfigs, type BackendToolContext } from "../tools";
import {
	MessageToolUpdateType,
	MessageUpdateStatus,
	MessageUpdateType,
	type MessageUpdate,
} from "$lib/types/MessageUpdate";
import type { TextGenerationContext } from "./types";

import directlyAnswer from "../tools/directlyAnswer";
import websearch from "../tools/web/search";
import { z } from "zod";
import { logger } from "../logger";
import { extractJson, toolHasName } from "../tools/utils";
import { mergeAsyncGenerators } from "$lib/utils/mergeAsyncGenerators";
import { MetricsServer } from "../metrics";
import { stringifyError } from "$lib/utils/stringifyError";
import { collections } from "../database";
import { ObjectId } from "mongodb";
import type { Message } from "$lib/types/Message";
import type { Assistant } from "$lib/types/Assistant";

export async function getTools(
	toolsPreference: Array<string>,
	assistant: Pick<Assistant, "tools"> | undefined
): Promise<Tool[]> {
	let preferences = toolsPreference;

	if (assistant) {
		if (assistant?.tools?.length) {
			preferences = assistant.tools;
		} else {
			return [directlyAnswer, websearch];
		}
	}

	// filter based on tool preferences, add the tools that are on by default
	const activeConfigTools = toolFromConfigs.filter((el) => {
		if (el.isLocked && el.isOnByDefault && !assistant) return true;
		return preferences?.includes(el._id.toString()) ?? (el.isOnByDefault && !assistant);
	});

	// find tool where the id is in preferences
	const activeCommunityTools = await collections.tools
		.find({
			_id: { $in: preferences.map((el) => new ObjectId(el)) },
		})
		.toArray()
		.then((el) => el.map((el) => ({ ...el, call: getCallMethod(el) })));

	return [...activeConfigTools, ...activeCommunityTools];
}

async function* callTool(
	ctx: BackendToolContext,
	tools: Tool[],
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
		const toolResult = yield* tool.call(call.parameters, ctx, uuid);

		yield {
			type: MessageUpdateType.Tool,
			subtype: MessageToolUpdateType.Result,
			uuid,
			result: { ...toolResult, call, status: ToolResultStatus.Success },
		};

		MetricsServer.getMetrics().tool.toolUseDuration.observe(
			{ tool: call.name },
			Date.now() - startTime
		);

		await collections.tools.findOneAndUpdate({ _id: tool._id }, { $inc: { useCount: 1 } });

		return { ...toolResult, call, status: ToolResultStatus.Success };
	} catch (error) {
		MetricsServer.getMetrics().tool.toolUseCountError.inc({ tool: call.name });
		logger.error(error, `Failed while running tool ${call.name}. ${stringifyError(error)}`);

		yield {
			type: MessageUpdateType.Tool,
			subtype: MessageToolUpdateType.Error,
			uuid,
			message:
				"An error occurred while calling the tool " + call.name + ": " + stringifyError(error),
		};

		return {
			call,
			status: ToolResultStatus.Error,
			message:
				"An error occurred while calling the tool " + call.name + ": " + stringifyError(error),
		};
	}
}

export async function* runTools(
	ctx: TextGenerationContext,
	tools: Tool[],
	preprompt?: string
): AsyncGenerator<MessageUpdate, ToolResult[], undefined> {
	const { endpoint, conv, messages, assistant, ip, username } = ctx;
	const calls: ToolCall[] = [];

	const pickToolStartTime = Date.now();
	// append a message with the list of all available files

	const files = messages.reduce((acc, curr, idx) => {
		if (curr.files) {
			const prefix = (curr.from === "user" ? "input" : "ouput") + "_" + idx;
			acc.push(
				...curr.files.map(
					(file, fileIdx) => `${prefix}_${fileIdx}.${file?.name?.split(".")?.pop()?.toLowerCase()}`
				)
			);
		}
		return acc;
	}, [] as string[]);

	let formattedMessages = messages.map((message, msgIdx) => {
		let content = message.content;

		if (message.files && message.files.length > 0) {
			content +=
				"\n\nAdded files: \n - " +
				message.files
					.map((file, fileIdx) => {
						const prefix = message.from === "user" ? "input" : "output";
						const fileName = file.name.split(".").pop()?.toLowerCase();

						return `${prefix}_${msgIdx}_${fileIdx}.${fileName}`;
					})
					.join("\n - ");
		}

		return {
			...message,
			content,
		} satisfies Message;
	});

	const fileMsg = {
		id: crypto.randomUUID(),
		from: "system",
		content:
			"Here is the list of available filenames that can be used as input for tools. Use the filenames that are in this list. \n The filename structure is as follows : {input for user|output for tool}_{message index in the conversation}_{file index in the list of files}.{file extension} \n - " +
			files.join("\n - ") +
			"\n\n\n",
	} satisfies Message;

	// put fileMsg before last if files.length > 0
	formattedMessages = files.length
		? [...formattedMessages.slice(0, -1), fileMsg, ...formattedMessages.slice(-1)]
		: messages;

	// do the function calling bits here
	for await (const output of await endpoint({
		messages: formattedMessages,
		preprompt,
		generateSettings: assistant?.generateSettings,
		tools: tools.map((tool) => ({
			...tool,
			inputs: tool.inputs.map((input) => ({
				...input,
				type: input.type === "file" ? "str" : input.type,
			})),
		})),
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
					.map((call) => externalToToolCall(call, tools))
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

function externalToToolCall(call: ExternalToolCall, tools: Tool[]): ToolCall | undefined {
	// Convert - to _ since some models insist on using _ instead of -
	const tool = tools.find((tool) => toolHasName(call.tool_name, tool));

	if (!tool) {
		logger.debug(`Model requested tool that does not exist: "${call.tool_name}". Skipping tool...`);
		return;
	}

	const parametersWithDefaults: Record<string, string> = {};

	for (const input of tool.inputs) {
		const value = call.parameters[input.name];

		// Required so ensure it's there, otherwise return undefined
		if (input.paramType === "required") {
			if (value === undefined) {
				logger.debug(
					`Model requested tool "${call.tool_name}" but was missing required parameter "${input.name}". Skipping tool...`
				);
				return;
			}
			parametersWithDefaults[input.name] = value;
			continue;
		}

		// Optional so use default if not there
		parametersWithDefaults[input.name] = value;

		if (input.paramType === "optional") {
			parametersWithDefaults[input.name] ??= input.default.toString();
		}
	}

	return {
		name: call.tool_name,
		parameters: parametersWithDefaults,
	};
}
