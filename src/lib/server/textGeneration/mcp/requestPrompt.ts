import type { ObjectId } from "mongodb";
import type {
	ChatCompletionCreateParamsStreaming,
	ChatCompletionMessageParam,
} from "openai/resources/chat/completions";
import { config } from "$lib/server/config";
import type { Conversation } from "$lib/types/Conversation";
import type { EndpointMessage } from "$lib/server/endpoints/endpoints";
import type { ImageProcessor } from "$lib/server/endpoints/images";
import type { McpServerConfig } from "$lib/server/mcp/httpClient";
import type { McpToolMapping, OpenAiTool } from "$lib/server/mcp/tools";
import { withRepairedToolSchemas } from "$lib/server/mcp/schemaRepair";
import { withRequiredDiscriminators } from "$lib/server/mlBudget/guard";
import { mlAssistantModelEntry } from "$lib/server/mlAssistantModels";
import { injectSessionState } from "$lib/server/mlRegistry/stateBlock";
import { ML_ASSISTANT_MIN_COMPLETION_TOKENS } from "$lib/constants/mlAssistant";
import type { StoredHistoryWindow } from "$lib/types/Conversation";
import { prepareHistory } from "../utils/prepareFiles";
import { buildToolPreprompt } from "../utils/toolPrompt";
import type { AttachmentMode } from "../utils/attachmentBudget";
import { createHistoryWindow, historyCost, windowLimitChars } from "../utils/historyWindow";
import type { ToolImageReader } from "../utils/toolImages";
import { injectPlanState, PLAN_TOOL_NAME } from "../builtinTools/planTool";
import type { BuiltinTool } from "../builtinTools";

/*
 * What the model is sent for a round, shared by runMcpFlow and the decision evals
 * (evals/decisions/), so an eval measures the request prod builds, not a copy of it.
 */

export function assembleTools({
	builtinTools,
	mcpTools,
	mapping,
	servers,
	mlAssistant,
	virtualFiles,
}: {
	builtinTools: BuiltinTool[];
	mcpTools: OpenAiTool[];
	mapping: Record<string, McpToolMapping>;
	servers: McpServerConfig[];
	mlAssistant: boolean;
	virtualFiles: boolean;
}) {
	// An MCP tool that collides with a builtin name is dropped: dispatch checks
	// builtins first, so the MCP twin would be advertised but unreachable.
	const builtinNames = new Set(builtinTools.map((tool) => tool.name));
	const collisions = mcpTools.filter((tool) => builtinNames.has(tool.function.name));
	// In the mode, gated tools advertise their routing discriminator as
	// required — the Hub's own schema doesn't, and calls without one can only
	// bounce off the budget gate's fail-closed path.
	const gatedMcpTools = mlAssistant ? withRequiredDiscriminators(mcpTools, mapping) : mcpTools;
	// Applied to every conversation, mode or not: the Hub tools whose real
	// interface is a grammar in prose misfire the same way whoever is calling
	// them. See mcp/schemaRepair.ts for what the traces showed.
	const shapedMcpTools = withRepairedToolSchemas(gatedMcpTools, mapping, servers, {
		virtualFiles,
	});
	const oaTools = [
		...builtinTools.map((tool) => tool.definition),
		...shapedMcpTools.filter((tool) => !builtinNames.has(tool.function.name)),
	];
	return { oaTools, shapedMcpTools, collisions };
}

export function completionSettings({
	targetModel,
	mlAssistant,
	generateSettings,
}: {
	targetModel: { id?: string; name: string; parameters?: unknown; contextLength?: number };
	mlAssistant: boolean;
	generateSettings?: Record<string, unknown>;
}) {
	const parameters = {
		...(targetModel.parameters as Record<string, unknown> | undefined),
		...(mlAssistant ? mlAssistantModelEntry(targetModel.id || targetModel.name)?.parameters : {}),
		...generateSettings,
	} as Record<string, unknown>;
	const catalogMaxTokens =
		(parameters?.max_tokens as number | undefined) ??
		(parameters?.max_new_tokens as number | undefined) ??
		(parameters?.max_completion_tokens as number | undefined);
	const contextLength = targetModel.contextLength;
	// The preset floors the reply allowance — see the constant for why. The
	// floor never claims more than half the model's window: prompt plus reply
	// must fit it, and a backend that enforces the sum would reject the very
	// first request of a small-window model. A catalog value above the floor
	// still wins. The research sub-agent inherits this through completionBase.
	const clampedFloor = contextLength
		? Math.min(ML_ASSISTANT_MIN_COMPLETION_TOKENS, Math.floor(contextLength / 2))
		: ML_ASSISTANT_MIN_COMPLETION_TOKENS;
	const maxTokens = mlAssistant ? Math.max(catalogMaxTokens ?? 0, clampedFloor) : catalogMaxTokens;
	return { parameters, maxTokens, contextLength };
}

export type CompletionBase = Omit<ChatCompletionCreateParamsStreaming, "messages"> & {
	reasoning_effort?: "low" | "medium" | "high";
};

export function completionRequestBase({
	model,
	provider,
	parameters,
	maxTokens,
	tools,
	reasoningEffort,
}: {
	model: string;
	provider?: string;
	parameters: Record<string, unknown>;
	maxTokens?: number;
	tools: OpenAiTool[];
	reasoningEffort?: "low" | "medium" | "high";
}): CompletionBase {
	const stopSequences =
		typeof parameters?.stop === "string"
			? parameters.stop
			: Array.isArray(parameters?.stop)
				? (parameters.stop as string[])
				: undefined;
	return {
		// e.g. "model:fastest" or "model:together"
		model: provider && provider !== "auto" ? `${model}:${provider}` : model,
		stream: true,
		temperature: typeof parameters?.temperature === "number" ? parameters.temperature : undefined,
		top_p: typeof parameters?.top_p === "number" ? parameters.top_p : undefined,
		frequency_penalty:
			typeof parameters?.frequency_penalty === "number"
				? parameters.frequency_penalty
				: typeof parameters?.repetition_penalty === "number"
					? parameters.repetition_penalty
					: undefined,
		presence_penalty:
			typeof parameters?.presence_penalty === "number" ? parameters.presence_penalty : undefined,
		stop: stopSequences,
		max_tokens: typeof maxTokens === "number" ? maxTokens : undefined,
		tools,
		tool_choice: "auto",
		...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
	};
}

/** the tool doctrine ahead of the conversation's preprompt */
export function mergePreprompt({
	oaTools,
	builtinTools,
	preprompt,
	timezone,
	mlAssistant,
}: {
	oaTools: OpenAiTool[];
	builtinTools: BuiltinTool[];
	preprompt?: string;
	timezone?: string;
	mlAssistant: boolean;
}): string {
	// In the mode the doctrine paragraphs are swapped, not appended to: the
	// generic restraint rule tells the model not to reach for a tool unless it
	// lacks a capability, and names writing code as a case to answer directly,
	// which is the inverse of the preset's doctrine.
	const toolPreprompt = buildToolPreprompt(oaTools, timezone, builtinTools, { mlAssistant });
	const pieces: string[] = [];
	if (toolPreprompt.trim().length > 0) pieces.push(toolPreprompt);
	if (typeof preprompt === "string" && preprompt.trim().length > 0) pieces.push(preprompt);
	return pieces.join("\n\n");
}

export async function buildRequestPrompt({
	messages,
	attachments,
	imageProcessor,
	multimodal,
	readToolImage,
	echoReasoning,
	producerModel,
	contextLength,
	maxTokens,
	slidingWindow,
	mlAssistant,
	systemPrompt,
	oaTools,
	builtinTools,
	conv,
	messageId,
	turnContext,
	stateBlock,
	saveWindow,
}: {
	messages: EndpointMessage[];
	attachments: AttachmentMode;
	imageProcessor: ImageProcessor;
	multimodal: boolean;
	readToolImage?: ToolImageReader;
	echoReasoning: boolean;
	producerModel: string;
	contextLength?: number;
	maxTokens?: number;
	slidingWindow: boolean;
	mlAssistant: boolean;
	systemPrompt: string;
	oaTools: OpenAiTool[];
	builtinTools: BuiltinTool[];
	conv: Pick<Conversation, "_id" | "plan" | "historyWindow">;
	messageId?: string;
	turnContext?: string;
	stateBlock?: string;
	/** where the window start is kept, the conversation by default */
	saveWindow?: (conversationId: ObjectId, start: StoredHistoryWindow) => Promise<void>;
}) {
	const history = await prepareHistory(messages, imageProcessor, multimodal, {
		replayToolHistory: true,
		readToolImage,
		attachReasoning: echoReasoning,
		// The model resolved for THIS turn. Under the "omni" router alias a
		// prior turn in the same conversation can have been produced by a
		// different model (per-message routing, no user action needed); this
		// gates reasoning_content to only replay onto its own producer.
		currentProducerModel: producerModel,
		// The resolved target's window, not the router alias's: under "omni"
		// the alias itself has none, and the candidate is what serves this
		// request.
		contextLengthTokens: contextLength,
		maxOutputTokens: maxTokens,
		slidingWindow,
		attachments,
		mlAssistant,
	});
	let prompt: ChatCompletionMessageParam[] = history.messages;
	const hasSystemMessage = prompt.length > 0 && prompt[0]?.role === "system";
	if (hasSystemMessage) {
		if (systemPrompt.length > 0) {
			const existing = prompt[0].content ?? "";
			const existingText = typeof existing === "string" ? existing : "";
			prompt[0].content = systemPrompt + (existingText ? "\n\n" + existingText : "");
		}
	} else if (systemPrompt.length > 0) {
		prompt = [{ role: "system", content: systemPrompt }, ...prompt];
	}

	const window =
		history.units && contextLength
			? createHistoryWindow({
					conversationId: conv._id,
					units: history.units,
					offset: prompt.length - history.messages.length,
					limitChars: windowLimitChars(contextLength, maxTokens),
					fixedChars: historyCost(oaTools),
					stored: conv.historyWindow,
					liveMessageId: messageId,
					...(saveWindow ? { save: saveWindow } : {}),
				})
			: undefined;

	// Tail-injected once per turn; within the turn, freshness travels in the tool
	// results. Gated on the tool being offered so a stale plan can't tell the model
	// to call a tool it doesn't have.
	if (conv.plan && builtinTools.some((tool) => tool.name === PLAN_TOOL_NAME)) {
		prompt = injectPlanState(prompt, conv.plan);
	}
	const tail = [turnContext, stateBlock].filter((text): text is string => !!text);
	if (tail.length > 0) {
		prompt = injectSessionState(prompt, tail.join("\n\n"));
	}

	// Work around servers that reject `system` role
	if (
		typeof config.OPENAI_BASE_URL === "string" &&
		config.OPENAI_BASE_URL.length > 0 &&
		(config.OPENAI_BASE_URL.includes("hf.space") ||
			config.OPENAI_BASE_URL.includes("gradio.app")) &&
		prompt[0]?.role === "system"
	) {
		prompt[0] = { ...prompt[0], role: "user" };
	}
	return { prompt, window, attachments: history.attachments };
}
