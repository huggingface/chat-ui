/**
 * Hermetic e2e stack — no API keys, no external services, no network.
 *
 * The `webServer` array below is the startup order, and it is load-bearing: the app throws at
 * boot without `${OPENAI_BASE_URL}/models` and `process.exit(1)`s without Mongo, so both must be
 * listening first. `globalSetup` cannot do this — the runner builds `webServer` tasks before
 * global-setup tasks.
 *
 * Addresses are always IP literals, never `localhost`: `ssrfSafeFetch` blocks `localhost` (it
 * resolves to `::1`) but allows literals, since undici only runs its SSRF `lookup` hook for
 * hostnames needing DNS.
 *
 * Serial because one app and one database are shared and the `db` fixture wipes between tests.
 * Raising `PLAYWRIGHT_WORKERS` also means scoping scenarios per conversation and rethinking the
 * wipe.
 */
import { defineConfig, devices } from "playwright/test";
import {
	E2E_APP_PORT,
	E2E_APP_URL,
	E2E_DB_NAME,
	E2E_MONGO_PORT,
	E2E_MONGO_URL,
	MOCK_MCP_ORIGIN,
	MOCK_OPENAI_BASE_URL,
	MOCK_OPENAI_ORIGIN,
} from "./tests/fixtures.ts";

/** Node < 22.18 needs the flag; on newer versions it is accepted and inert. */
const NODE_TS = "node --experimental-strip-types --no-warnings";

const isCI = Boolean(process.env.CI);

export default defineConfig({
	testDir: "./tests",
	testMatch: /.*\.spec\.ts/,
	outputDir: "./test-results",

	fullyParallel: false,
	workers: Number(process.env.PLAYWRIGHT_WORKERS ?? 1),
	forbidOnly: isCI,
	retries: isCI ? 2 : 0,

	timeout: 60_000,
	expect: { timeout: 15_000 },

	reporter: isCI
		? [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]]
		: [["list"]],

	use: {
		baseURL: E2E_APP_URL,
		trace: "on-first-retry",
		screenshot: "only-on-failure",
		video: "retain-on-failure",
	},

	projects: [
		{ name: "chromium", use: { ...devices["Desktop Chrome"] } },
		// Not optional — the worst regression cluster in this repo is Safari-specific scroll and
		// layout behaviour.
		{ name: "webkit", use: { ...devices["Desktop Safari"] } },
	],

	webServer: [
		{
			// Database first — the app exits if it cannot connect.
			command: `${NODE_TS} tests/fixtures.ts`,
			port: E2E_MONGO_PORT,
			reuseExistingServer: !isCI,
			timeout: 120_000,
			stdout: "pipe",
			stderr: "pipe",
		},
		{
			// Then the LLM upstream — the app throws at boot without /v1/models.
			command: `${NODE_TS} tests/mock-openai.ts`,
			url: `${MOCK_OPENAI_ORIGIN}/__control/health`,
			reuseExistingServer: !isCI,
			timeout: 30_000,
			stdout: "pipe",
			stderr: "pipe",
		},
		{
			command: `${NODE_TS} tests/mock-mcp.ts`,
			url: `${MOCK_MCP_ORIGIN}/health`,
			reuseExistingServer: !isCI,
			timeout: 30_000,
			stdout: "pipe",
			stderr: "pipe",
		},
		{
			// The app last, through `server.js` — the same entry point production uses, rather than
			// `vite preview`. Two reasons: it exercises the polka compression config that keeps
			// `application/jsonl` unbuffered, and it loads no vite/svelte config, so the
			// `dotenv.config({ override: true })` in svelte.config.js cannot replace the hermetic
			// values below with whatever a developer has in `.env.local`.
			command: `npm run build && node server.js`,
			url: E2E_APP_URL,
			reuseExistingServer: !isCI,
			timeout: 300_000,
			// Request logging at info level buries the test results; errors still reach stderr.
			stdout: "ignore",
			stderr: "pipe",
			env: {
				HOST: "127.0.0.1",
				PORT: String(E2E_APP_PORT),
				LOG_LEVEL: "warn",
				OPENAI_BASE_URL: MOCK_OPENAI_BASE_URL,
				OPENAI_API_KEY: "e2e-test-key",
				MONGODB_URL: E2E_MONGO_URL,
				MONGODB_DB_NAME: E2E_DB_NAME,
				MONGODB_DIRECT_CONNECTION: "true",
				PUBLIC_ORIGIN: E2E_APP_URL,
				PUBLIC_APP_ASSETS: "chatui",
				COOKIE_NAME: "hf-chat",
				// A production build defaults `secure` to true and the app re-sets the session
				// cookie on every POST. Playwright's APIRequestContext enforces `Secure` strictly
				// over plain HTTP, so without this every `request.post` lands on a new session.
				COOKIE_SECURE: "false",
				COOKIE_SAMESITE: "lax",
				// Deterministic surface: no DB-driven config, no router, no ambient MCP servers.
				ENABLE_CONFIG_MANAGER: "false",
				MCP_SERVERS: "[]",
				LLM_ROUTER_ROUTES_PATH: "",
				LLM_ROUTER_ARCH_BASE_URL: "",
				ALLOW_IFRAME: "true",
				NODE_ENV: "production",
			},
		},
	],
});
