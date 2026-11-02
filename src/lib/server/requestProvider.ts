import { config } from "$lib/server/config";
import { logger } from "$lib/server/logger";
import { isMlAssistantConversation } from "$lib/server/mlAssistant";
import { mlAssistantProviderFor } from "$lib/server/mlAssistantModels";
import type { Conversation } from "$lib/types/Conversation";

/** provider values that let the HF router pick, rather than naming one provider */
export const PROVIDER_POLICIES = new Set(["auto", "fastest", "cheapest", "preferred"]);

interface RequestModel {
	id: string;
	isRouter?: boolean;
	defaultProvider?: string;
	providers?: Array<Record<string, unknown>>;
}

export interface ProviderChoice {
	provider?: string;
	/** the model's default rather than anyone's pick, so it may be routed around when it is down */
	providerIsDefault: boolean;
}

/** provider suffix for a HuggingChat request, an unlisted provider falls back to the default then auto since the router hides billing disabled ones but still 402s them */
export function requestProvider(
	model: RequestModel,
	conv: Pick<Conversation, "mlAssistant">,
	providerOverrides: Record<string, string> | undefined
): ProviderChoice {
	if (!config.isHuggingChat || model.isRouter) return { providerIsDefault: false };
	// a saved "auto" is the user asking for their own Hub order, so only an unset one takes the default
	const saved = providerOverrides?.[model.id] || undefined;
	const picked = isMlAssistantConversation(conv) ? mlAssistantProviderFor(model.id, saved) : saved;
	if (picked && isListed(model, picked)) return { provider: picked, providerIsDefault: false };
	if (picked) {
		logger.warn(
			{ model: model.id, provider: picked },
			"[inference] provider is not listed for the model; using the default"
		);
	}
	return routedProvider(model);
}

/** provider suffix for a model Omni routed to, the user picked Omni rather than a provider so only the model's default applies */
export function routedProvider(model: RequestModel): ProviderChoice {
	const provider = listedDefaultProvider(model);
	return { provider, providerIsDefault: provider !== undefined };
}

/** the model's default provider when the router lists it, what an unpicked request is sent to */
export function listedDefaultProvider(model: RequestModel): string | undefined {
	if (!config.isHuggingChat || model.isRouter || !model.defaultProvider) return undefined;
	return isListed(model, model.defaultProvider) ? model.defaultProvider : undefined;
}

function isListed(model: RequestModel, provider: string): boolean {
	if (PROVIDER_POLICIES.has(provider)) return true;
	const listed = (model.providers ?? []).map((p) => p.provider);
	return listed.length === 0 || listed.includes(provider);
}
