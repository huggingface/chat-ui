/**
 * The request production sends at a case's cut, built by the app's own code (requestPrompt.ts and
 * what feeds it), so an eval run on a branch measures that branch's prompt and tools.
 *
 * Import only after the environment is set (see run.ts): the app reads its config at import.
 * Left out, because they need production's database: the session state block (running jobs,
 * files), the conversation's plan, the stored history window start, uploaded files and tool
 * images. Those are the same in every arm.
 */
import { createHash } from "node:crypto";
import { ObjectId } from "mongodb";
import type { ChatCompletionCreateParamsStreaming } from "openai/resources/chat/completions";
import { preprocessMessages } from "$lib/server/endpoints/preprocessMessages";
import { makeImageProcessor } from "$lib/server/endpoints/images";
import { isExaMcpServer, isStrictHfMcpLogin, hasAuthHeader } from "$lib/server/mcp/hf";
import { getMcpServers } from "$lib/server/mcp/registry";
import { getOpenAiToolsForMcp } from "$lib/server/mcp/tools";
import { withMlAssistantServers } from "$lib/server/mlAssistant";
import { mlVirtualFilesEnabled } from "$lib/server/mlFiles/enabled";
import { mlStateBlockEnabled } from "$lib/server/mlRegistry/stateBlock";
import { models } from "$lib/server/models";
import { config } from "$lib/server/config";
import { isValidUrl } from "$lib/server/urlSafety";
import { getEnabledBuiltinTools } from "$lib/server/textGeneration/builtinTools";
import {
	assembleTools,
	buildRequestPrompt,
	completionRequestBase,
	completionSettings,
	mergePreprompt,
} from "$lib/server/textGeneration/mcp/requestPrompt";
import { resolvePreprompt, resolveTurnContext } from "$lib/server/textGeneration/preprompt";
import { attachmentBudgetEnabled } from "$lib/server/textGeneration/utils/attachmentBudgetFlag";
import { MAX_IMAGE_BYTES, MAX_IMAGES } from "$lib/server/textGeneration/utils/attachmentBudget";
import { historyWindowEnabled } from "$lib/server/textGeneration/utils/historyWindowFlag";
import { limitToolImages } from "$lib/server/textGeneration/utils/toolImages";
import type { Message } from "$lib/types/Message";
import type { DecisionCase } from "./types";

/** stands in for the user in the session context, where the prompt names their namespace */
const EVAL_USER = "ml-intern-eval";

export type SampleRequest = ChatCompletionCreateParamsStreaming;

export interface RequestSettings {
	model: string;
	provider: string;
	/** the compute budget the turn context reports, production's is not in the exports */
	budgetUsd: number;
}

/** export dates arrive as {"$date": "..."} */
function revive(message: Message): Message {
	const date = (value: unknown) =>
		value && typeof value === "object" && "$date" in value
			? new Date((value as { $date: string }).$date)
			: value;
	return {
		...message,
		createdAt: date(message.createdAt) as Date,
		updatedAt: date(message.updatedAt) as Date,
		files: [],
	};
}

/** mirrors runMcpFlow's server setup for a mode conversation with no extra servers picked */
function servers(token: string) {
	return withMlAssistantServers(getMcpServers())
		.filter((s) => isValidUrl(s.url, { allowInsecure: true }))
		.map((s) => {
			if (isStrictHfMcpLogin(s.url) && !hasAuthHeader(s.headers)) {
				return { ...s, headers: { ...(s.headers ?? {}), Authorization: `Bearer ${token}` } };
			}
			if (isExaMcpServer(s.url) && config.EXA_API_KEY) {
				const url = new URL(s.url);
				url.searchParams.set("exaApiKey", config.EXA_API_KEY);
				return { ...s, url: url.toString() };
			}
			return s;
		});
}

const sha = (value: unknown) =>
	createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);

export async function requestBuilder(settings: RequestSettings, token: string) {
	const targetModel = models.find((m) => m.id === settings.model || m.name === settings.model);
	if (!targetModel) throw new Error(`model ${settings.model} is not on the router`);
	const mcpServers = servers(token);
	const { tools: mcpTools, mapping } = await getOpenAiToolsForMcp(mcpServers);
	const imageProcessor = makeImageProcessor({
		supportedMimeTypes: ["image/png", "image/jpeg"],
		preferredMimeType: "image/jpeg",
		maxSizeInMB: 1,
		maxWidth: 1024,
		maxHeight: 1024,
	});
	const { parameters, maxTokens, contextLength } = completionSettings({
		targetModel,
		mlAssistant: true,
	});

	const build = async (c: DecisionCase) => {
		const conv = {
			_id: new ObjectId(c.source.conversationId),
			mlAssistant: true,
			mlBudget: {
				totalMicroUsd: settings.budgetUsd * 1_000_000,
				spentMicroUsd: 0,
				reservations: [],
			},
		};
		const messages = c.conversation.messages.map(revive);
		const now = messages[messages.length - 1].createdAt;
		const builtinTools = getEnabledBuiltinTools({ conv, namespace: EVAL_USER, hfToken: token });
		const { oaTools } = assembleTools({
			builtinTools,
			mcpTools,
			mapping,
			servers: mcpServers,
			mlAssistant: true,
			virtualFiles: mlVirtualFilesEnabled(conv),
		});
		const preprompt = resolvePreprompt({
			conversationPreprompt: c.conversation.preprompt,
			mlAssistant: true,
			virtualFiles: mlVirtualFilesEnabled(conv),
			stateBlock: mlStateBlockEnabled(conv),
			attachmentBudget: attachmentBudgetEnabled(),
			supportsArtifacts: targetModel.supportsArtifacts,
			username: EVAL_USER,
			publishNamespace: EVAL_USER,
			now,
		});
		const turnContext = resolveTurnContext({ mlAssistant: true, now, budget: conv.mlBudget });
		const systemPrompt = mergePreprompt({ oaTools, builtinTools, preprompt, mlAssistant: true });
		const built = await buildRequestPrompt({
			messages: await preprocessMessages(messages, conv._id),
			attachments: "budget",
			imageProcessor,
			multimodal: targetModel.multimodal,
			echoReasoning: targetModel.preservesReasoning !== false,
			producerModel: targetModel.id ?? targetModel.name,
			contextLength,
			maxTokens,
			slidingWindow: historyWindowEnabled(),
			mlAssistant: true,
			systemPrompt,
			oaTools,
			builtinTools,
			conv,
			messageId: c.source.messageId,
			turnContext,
			saveWindow: async () => {},
		});
		const fitted = built.window ? await built.window.fit(built.prompt) : built.prompt;
		const request: SampleRequest = {
			...completionRequestBase({
				model: targetModel.id ?? targetModel.name,
				provider: settings.provider,
				parameters,
				maxTokens,
				tools: oaTools,
			}),
			messages: limitToolImages(fitted, { maxImages: MAX_IMAGES, maxBytes: MAX_IMAGE_BYTES }),
		};
		return {
			request,
			/** equal across arms when nothing the model sees changed */
			requestHash: sha(request),
			promptHash: sha([systemPrompt, oaTools]),
		};
	};

	return {
		build,
		baseUrl: config.OPENAI_BASE_URL,
		tools: mcpTools.map((t) => t.function.name),
		flags: {
			virtualFiles: config.ML_ASSISTANT_VIRTUAL_FILES !== "false",
			slidingWindow: historyWindowEnabled(),
			attachmentBudget: attachmentBudgetEnabled(),
		},
	};
}
