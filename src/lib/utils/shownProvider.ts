/** the provider a model's badge shows: the user's pick, else HuggingChat's default for the model, nothing for auto or Omni */
export function shownProvider(
	model: { id: string; isRouter?: boolean; defaultProvider?: string },
	providerOverrides: Record<string, string> | undefined
): string | undefined {
	if (model.isRouter) return undefined;
	// a saved "auto" is a choice of the user's own Hub order, so it hides the default too
	const provider = providerOverrides?.[model.id] || model.defaultProvider;
	return provider && provider !== "auto" ? provider : undefined;
}
