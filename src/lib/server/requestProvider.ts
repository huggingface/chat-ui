import { config } from "$lib/server/config";
import { logger } from "$lib/server/logger";
import { isMlAssistantConversation } from "$lib/server/mlAssistant";
import { mlAssistantProviderFor } from "$lib/server/mlAssistantModels";
import { PROVIDER_POLICIES } from "$lib/server/providerLimits";
import type { Conversation } from "$lib/types/Conversation";

interface RequestModel {
	id: string;
	isRouter?: boolean;
	defaultProvider?: string;
	providers?: Array<Record<string, unknown>>;
}

/** provider suffix for a HuggingChat request, an unlisted provider falls back to auto since the router hides billing disabled ones but still 402s them */
export function requestProvider(
	model: RequestModel,
	conv: Pick<Conversation, "mlAssistant">,
	providerOverrides: Record<string, string> | undefined
): string | undefined {
	if (!config.isHuggingChat || model.isRouter) return undefined;
	// a saved "auto" is the user asking for their own Hub order, so only an unset one takes the default
	const preference = providerOverrides?.[model.id] || model.defaultProvider;
	const provider = isMlAssistantConversation(conv)
		? mlAssistantProviderFor(model.id, preference)
		: preference;
	return listedProvider(model, provider);
}

/** provider suffix for a model Omni routed to, the user picked Omni rather than a provider so only the model's default applies */
export function routedProvider(model: RequestModel): string | undefined {
	if (!config.isHuggingChat || model.isRouter) return undefined;
	return listedProvider(model, model.defaultProvider);
}

function listedProvider(model: RequestModel, provider: string | undefined): string | undefined {
	if (!provider || PROVIDER_POLICIES.has(provider)) return provider;
	const listed = (model.providers ?? []).map((p) => p.provider);
	if (listed.length === 0 || listed.includes(provider)) return provider;
	logger.warn(
		{ model: model.id, provider },
		"[inference] provider is not listed for the model; using auto"
	);
	return undefined;
}
