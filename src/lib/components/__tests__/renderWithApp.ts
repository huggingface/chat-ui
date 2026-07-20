/**
 * Mounts application components with the Svelte context `+layout.svelte` normally establishes,
 * alongside the `$app/*` mocks in `./appMocks`.
 *
 * ```ts
 * renderWithApp(ChatMessage, { message });
 * renderWithApp(ToolUpdate, { tool }, { page: { data: { tools } } });
 * ```
 */
import { render, type Component, type ComponentType, type Props } from "vitest-browser-svelte";

import { getConfigManager } from "$lib/utils/PublicConfig.svelte";
import { ARTIFACTS_CONTEXT_KEY, type ArtifactsContext } from "$lib/utils/artifactsContext";
import { navigation, setPage, type AppPageOverrides } from "./appMocks";

export { setPage } from "./appMocks";

/** The `$app/navigation` spies, for asserting a component navigated. */
export function appNavigation() {
	return navigation;
}

const DEFAULT_PUBLIC_CONFIG: Record<string, string> = {
	PUBLIC_ORIGIN: "http://localhost:3000",
	PUBLIC_APP_NAME: "chat-ui",
	PUBLIC_APP_ASSETS: "chatui",
	PUBLIC_APP_DESCRIPTION: "A test instance of chat-ui",
	PUBLIC_COMMIT_SHA: "test-sha",
	PUBLIC_VERSION: "test",
};

export interface RenderWithAppOptions {
	page?: AppPageOverrides;
	/** `PUBLIC_*` values merged over the defaults. `PUBLIC_APP_ASSETS` drives `isHuggingChat`. */
	publicConfig?: Record<string, string>;
	artifacts?: ArtifactsContext;
	/** Extra context entries, applied last so they win over the defaults. */
	context?: Map<unknown, unknown>;
	baseElement?: HTMLElement;
}

export function renderWithApp<C extends Component>(
	Component: ComponentType<C>,
	props?: Props<C>,
	options: RenderWithAppOptions = {}
) {
	if (options.page) setPage(options.page);

	const context = new Map<unknown, unknown>([
		["publicConfig", getConfigManager({ ...DEFAULT_PUBLIC_CONFIG, ...options.publicConfig })],
	]);

	if (options.artifacts) context.set(ARTIFACTS_CONTEXT_KEY, options.artifacts);
	if (options.context) for (const [key, value] of options.context) context.set(key, value);

	return render(Component, { props: props ?? ({} as Props<C>), context } as never, {
		baseElement: options.baseElement,
	});
}
