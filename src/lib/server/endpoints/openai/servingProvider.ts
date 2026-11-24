/**
 * The provider that served a completion. The HF router answers `x-inference-provider: openrouter`
 * for the calls it sends through OpenRouter, whose chunks name the provider that served them by
 * display name ("DeepInfra"): mapped back to the router's id with the model's provider list, as the
 * router does for its usage, or kept as is when the list doesn't have it.
 */
export function servingProvider(
	model: { providers?: Array<Record<string, unknown>> },
	headerProvider: string | undefined,
	servedBy: string | undefined
): string | undefined {
	if (headerProvider !== "openrouter" || !servedBy) return headerProvider;
	const listed = model.providers?.find((p) => p.provider_name === servedBy)?.provider;
	return typeof listed === "string" ? listed : servedBy;
}
