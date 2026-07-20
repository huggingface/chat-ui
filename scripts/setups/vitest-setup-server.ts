import { vi, afterAll } from "vitest";
import dotenv from "dotenv";
import { resolve } from "path";
import fs from "fs";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MODELS_FIXTURE, TEST_OPENAI_BASE_URL } from "../../src/lib/server/__fixtures__/models";

let mongoServer: MongoMemoryServer;
// Load the .env file
const envPath = resolve(__dirname, "../../.env");
dotenv.config({ path: envPath });

// Read the .env file content
const envContent = fs.readFileSync(envPath, "utf-8");

// Parse the .env content
const envVars = dotenv.parse(envContent);

// Separate public and private variables
const publicEnv = {};
const privateEnv = {};

for (const [key, value] of Object.entries(envVars)) {
	if (key.startsWith("PUBLIC_")) {
		publicEnv[key] = value;
	} else {
		privateEnv[key] = value;
	}
}

/*
 * Serve the model registry from a fixture instead of the network.
 *
 * `src/lib/server/models.ts` runs `await buildModels()` at module scope, guarded only by
 * `building` — which is false under Vitest. Any spec that transitively imports it therefore
 * used to hit the live upstream. This intercept keeps the real `buildModels()` code path
 * intact (fetch -> zod parse -> capability derivation -> override merge) while removing the
 * third-party dependency. Everything else falls through to the real `fetch`, so specs that
 * genuinely exercise the network (e.g. the SSRF/DNS suites) are unaffected.
 *
 * This must be installed before any module-scope `fetch` runs, which is why it lives in the
 * setup file body rather than in a `beforeAll`.
 */
const realFetch = globalThis.fetch;
const MODELS_URL = `${TEST_OPENAI_BASE_URL}/models`;

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
	const url = input instanceof Request ? input.url : String(input);

	if (url === MODELS_URL) {
		return new Response(JSON.stringify(MODELS_FIXTURE), {
			status: 200,
			headers: { "content-type": "application/json" },
		});
	}

	return realFetch(input, init);
}) as typeof fetch;

vi.mock("$env/dynamic/public", () => ({
	env: publicEnv,
}));

vi.mock("$env/dynamic/private", async () => {
	mongoServer = await MongoMemoryServer.create();

	return {
		env: {
			...privateEnv,
			MONGODB_URL: mongoServer.getUri(),
			// Pin the model registry at the intercepted fixture host. Must stay in sync with
			// the intercept above.
			OPENAI_BASE_URL: TEST_OPENAI_BASE_URL,
		},
	};
});

afterAll(async () => {
	globalThis.fetch = realFetch;

	if (mongoServer) {
		await mongoServer.stop();
	}
});
