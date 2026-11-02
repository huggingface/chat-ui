/** provider values that let the HF router pick, rather than naming one provider */
export const PROVIDER_POLICIES = new Set(["auto", "fastest", "cheapest", "preferred"]);

interface CappedModel {
	providerMaxTokens?: Record<string, number>;
}

/** max_tokens cap for a request, a named provider's own, otherwise the lowest since the router may pick any of them */
export function providerMaxTokensCap(
	model: CappedModel,
	provider: string | undefined
): number | undefined {
	const caps = model.providerMaxTokens;
	if (!caps) return undefined;
	if (provider && !PROVIDER_POLICIES.has(provider)) return caps[provider];
	const values = Object.values(caps);
	return values.length > 0 ? Math.min(...values) : undefined;
}

export function capMaxTokens(
	model: CappedModel,
	provider: string | undefined,
	maxTokens: number | undefined
): number | undefined {
	const cap = providerMaxTokensCap(model, provider);
	return maxTokens === undefined || cap === undefined ? maxTokens : Math.min(maxTokens, cap);
}
