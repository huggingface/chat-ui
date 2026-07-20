/**
 * Deterministic stand-in for `GET ${OPENAI_BASE_URL}/models`.
 *
 * `src/lib/server/models.ts` builds its registry from a top-level `await buildModels()`
 * guarded only by `building`. Under Vitest `building` is false, so importing anything that
 * transitively reaches `$lib/server/models` used to issue a live, unauthenticated request to
 * the configured upstream (the HF router). That made the suite depend on a third-party
 * endpoint being reachable and not rate-limiting, and is why individual tests were measured
 * at 3–5s against a 30s timeout.
 *
 * `scripts/setups/vitest-setup-server.ts` now points `OPENAI_BASE_URL` at an unroutable host
 * and serves this payload instead, so the real `buildModels()` code path still executes —
 * parsing, capability derivation, override merging — just without the network.
 *
 * The shape must satisfy `listSchema` in `src/lib/server/models.ts`.
 */

export const MODELS_FIXTURE = {
	object: "list",
	data: [
		{
			id: "test-org/test-model",
			description: "Deterministic test model with tool and image support",
			providers: [{ provider: "test-provider", supports_tools: true }],
			architecture: { input_modalities: ["text", "image"] },
		},
		{
			id: "test-org/text-only",
			description: "Deterministic test model, text input only, no tools",
			providers: [{ provider: "test-provider", supports_tools: false }],
			architecture: { input_modalities: ["text"] },
		},
	],
} as const;

/** Ids in the fixture, in registry order. `TEST_MODEL_IDS[0]` is the default model. */
export const TEST_MODEL_IDS = MODELS_FIXTURE.data.map((m) => m.id);

/**
 * Base URL the suite pins `OPENAI_BASE_URL` to. Deliberately unroutable: if the intercept
 * in the setup file ever stops matching, the request fails loudly instead of silently
 * reaching a real upstream.
 */
export const TEST_OPENAI_BASE_URL = "http://models.test.invalid/v1";
