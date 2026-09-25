import { createHash } from "crypto";
import type { Conversation } from "$lib/types/Conversation";
import type { Message, MessageHarness } from "$lib/types/Message";
import { config } from "$lib/server/config";
import { isMlAssistantConversation } from "$lib/server/mlAssistant";
import { mlAssistantModelEntry } from "$lib/server/mlAssistantModels";
import {
	ML_ASSISTANT_DOCTRINE_TOOLS,
	ML_ASSISTANT_TOOL_DOCTRINE,
	mlAssistantToolDoctrineBlocks,
} from "$lib/server/mlAssistantPrompt";
import { mlVirtualFilesEnabled } from "$lib/server/mlFiles/enabled";
import { mlServiceEventsEnabled, mlServicePollerEnabled } from "$lib/server/mlRegistry/enabled";
import { mlStateBlockEnabled } from "$lib/server/mlRegistry/stateBlock";
import { getEnabledBuiltinTools } from "$lib/server/textGeneration/builtinTools";
import { resolvePreprompt } from "$lib/server/textGeneration/preprompt";
import { historyWindowEnabled } from "$lib/server/textGeneration/utils/historyWindowFlag";

type HarnessConversation = Pick<Conversation, "_id" | "plan" | "mlAssistant">;

// fixed so the clock, user and budget in the session line never move the hash
const FIXED_CONTEXT = { timezone: "UTC", now: new Date(0) };

/** all model facing text the harness owns, under the current switches */
function mlAssistantPromptText(conv: HarnessConversation): string {
	const virtualFiles = mlVirtualFilesEnabled(conv);
	const stateBlock = mlStateBlockEnabled(conv);
	return [
		resolvePreprompt({ mlAssistant: true, virtualFiles, stateBlock, ...FIXED_CONTEXT }),
		...Object.values(ML_ASSISTANT_TOOL_DOCTRINE),
		...mlAssistantToolDoctrineBlocks(ML_ASSISTANT_DOCTRINE_TOOLS, {
			serviceEvents: mlServiceEventsEnabled(),
		}),
		...getEnabledBuiltinTools({ conv }).flatMap((tool) => [
			tool.preprompt ?? "",
			JSON.stringify(tool.definition),
		]),
	].join("\n\n");
}

export function mlAssistantPromptHash(conv: HarnessConversation): string {
	return createHash("sha256").update(mlAssistantPromptText(conv)).digest("hex").slice(0, 12);
}

/** replaces the previous run stamp, returns it for producers that set fields one by one */
export function stampMlHarness(
	message: Message,
	conv: HarnessConversation,
	model: { id: string; isRouter?: boolean }
): MessageHarness | undefined {
	if (!isMlAssistantConversation(conv)) return undefined;
	const provider =
		config.isHuggingChat && !model.isRouter ? mlAssistantModelEntry(model.id)?.provider : undefined;
	message.harness = {
		build: config.PUBLIC_COMMIT_SHA || "dev",
		prompt: mlAssistantPromptHash(conv),
		features: {
			virtualFiles: mlVirtualFilesEnabled(conv),
			stateBlock: mlStateBlockEnabled(conv),
			servicePoller: mlServicePollerEnabled(),
			serviceEvents: mlServiceEventsEnabled(),
			slidingWindow: historyWindowEnabled(),
		},
		model: model.id,
		...(provider ? { provider } : {}),
		runs: (message.harness?.runs ?? 0) + 1,
	};
	return message.harness;
}
