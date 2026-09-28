/**
 * Deterministic stand-in for `GET ${OPENAI_BASE_URL}/models`.
 * The shape must satisfy `listSchema` in `src/lib/server/models.ts`.
 */

export const MODELS_FIXTURE = {
	object: "list",
	data: [
		{
			id: "test-org/test-model",
			description: "Deterministic test model with tool and image support",
			// Two providers with different windows: the smaller one is what the
			// derived contextLength must take, since `provider: "auto"` means
			// either could serve the request.
			providers: [
				{ provider: "test-provider", supports_tools: true, context_length: 262144 },
				{ provider: "other-provider", supports_tools: true, context_length: 1048576 },
			],
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

export const TEST_MODEL_IDS = MODELS_FIXTURE.data.map((m) => m.id);
export const TEST_OPENAI_BASE_URL = "http://models.test.invalid/v1";
