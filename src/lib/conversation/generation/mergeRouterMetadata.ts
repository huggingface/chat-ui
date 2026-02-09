import type { Message } from "$lib/types/Message";

export type RouterMetadata = NonNullable<Message["routerMetadata"]>;
export type RouterMetadataIncoming = Partial<RouterMetadata> | undefined | null;

function hasValue(value: string | undefined): value is string {
	return Boolean(value && value.trim().length > 0);
}

export function mergeRouterMetadata(
	existing: Message["routerMetadata"],
	incoming: RouterMetadataIncoming
): RouterMetadata {
	const currentRoute = existing?.route ?? "";
	const currentModel = existing?.model ?? "";
	const currentProvider = existing?.provider;

	if (!incoming) {
		return currentProvider
			? { route: currentRoute, model: currentModel, provider: currentProvider }
			: { route: currentRoute, model: currentModel };
	}

	const route = hasValue(incoming.route) ? incoming.route : currentRoute;
	const model = hasValue(incoming.model) ? incoming.model : currentModel;
	const provider = incoming.provider ?? currentProvider;

	return provider ? { route, model, provider } : { route, model };
}
