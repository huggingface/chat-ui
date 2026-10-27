import { config } from "$lib/server/config";
import { logger } from "$lib/server/logger";
import { isMlAssistantConversation } from "$lib/server/mlAssistant";
import { mlAssistantProviderFor } from "$lib/server/mlAssistantModels";
import type { Conversation } from "$lib/types/Conversation";

const PROVIDER_POLICIES = new Set(["auto", "fastest", "cheapest", "preferred"]);

interface RequestModel {
	id: string;
	isRouter?: boolean;
	providers?: Array<Record<string, unknown>>;
}

/** provider suffix for a HuggingChat request, an unlisted provider falls back to auto since the router hides billing disabled ones but still 402s them */
export function requestProvider(
	model: RequestModel,
	conv: Pick<Conversation, "mlAssistant">,
	providerOverrides: Record<string, string> | undefined
): string | undefined {
	if (!config.isHuggingChat || model.isRouter) return undefined;
	const preference = providerOverrides?.[model.id];
	const provider = isMlAssistantConversation(conv)
		? mlAssistantProviderFor(model.id, preference)
		: preference;
	if (!provider || PROVIDER_POLICIES.has(provider)) return provider;
	const listed = (model.providers ?? []).map((p) => p.provider);
	if (listed.length === 0 || listed.includes(provider)) return provider;
	logger.warn(
		{ model: model.id, provider },
		"[inference] provider is not listed for the model; using auto"
	);
	return undefined;
}
