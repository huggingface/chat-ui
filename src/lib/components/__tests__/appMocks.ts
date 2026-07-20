/**
 * Stands in for the `$app/*` modules, which only exist inside a running SvelteKit app.
 *
 * Registered by `scripts/setups/vitest-setup-client.ts`, which imports this for its `vi.mock`
 * side effects. Lives under `src/` rather than in that setup file so it is type-checked.
 *
 * `page` is a plain object, not a `$state` proxy: overrides applied before mount are picked up,
 * changes made after it are not.
 */
import { beforeEach, vi } from "vitest";

const DEFAULT_ORIGIN = "http://localhost:3000";

export interface AppPage {
	url: URL;
	params: Record<string, string>;
	route: { id: string | null };
	status: number;
	error: App.Error | null;
	data: Record<string, unknown>;
	state: Record<string, unknown>;
	form: unknown;
}

const defaults = (): AppPage => ({
	url: new URL(`${DEFAULT_ORIGIN}/`),
	params: {},
	route: { id: null },
	status: 200,
	error: null,
	data: {},
	state: {},
	form: undefined,
});

export const page: AppPage = defaults();
export const paths = { base: "", assets: "" };
export const environment = { browser: true, dev: true, building: false };

export const navigation = {
	goto: vi.fn(async () => undefined),
	invalidate: vi.fn(async () => undefined),
	invalidateAll: vi.fn(async () => undefined),
	refreshAll: vi.fn(async () => undefined),
	preloadData: vi.fn(async () => ({ type: "loaded", status: 200, data: {} })),
	preloadCode: vi.fn(async () => undefined),
	pushState: vi.fn(() => undefined),
	replaceState: vi.fn(() => undefined),
	disableScrollHandling: vi.fn(() => undefined),
	afterNavigate: vi.fn(() => undefined),
	beforeNavigate: vi.fn(() => undefined),
	onNavigate: vi.fn(() => undefined),
};

export type AppPageOverrides = Partial<Omit<AppPage, "url">> & { url?: URL | string };

export function setPage(patch: AppPageOverrides): void {
	const { url, ...rest } = patch;
	Object.assign(page, rest);
	if (url !== undefined) page.url = typeof url === "string" ? new URL(url, DEFAULT_ORIGIN) : url;
}

export function resetAppMocks(): void {
	Object.assign(page, defaults());
	Object.assign(paths, { base: "", assets: "" });
	Object.assign(environment, { browser: true, dev: true, building: false });
	// `mockReset`, not `mockClear`: a test that stubs a spy — `goto.mockImplementation(...)` to
	// exercise a redirect path, say — would otherwise leak that implementation, and any queued
	// `mockResolvedValueOnce`, into every later test. Reset restores the factories above.
	for (const spy of Object.values(navigation)) spy.mockReset();
}

vi.mock("$app/state", () => ({
	page,
	navigating: { from: null, to: null, type: null, willUnload: false, delta: undefined },
	updated: { current: false, check: async () => false },
}));

vi.mock("$app/paths", () => ({
	get base() {
		return paths.base;
	},
	get assets() {
		return paths.assets;
	},
	resolve: (path: string) => `${paths.base}${path}`,
	asset: (path: string) => `${paths.assets}${path}`,
}));

vi.mock("$app/navigation", () => navigation);

vi.mock("$app/environment", () => ({
	get browser() {
		return environment.browser;
	},
	get dev() {
		return environment.dev;
	},
	get building() {
		return environment.building;
	},
	version: "test",
}));

beforeEach(resetAppMocks);
