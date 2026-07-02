import { error } from "@sveltejs/kit";
import { z } from "zod";
import { config } from "$lib/server/config";
import { getApiToken } from "$lib/server/apiToken";
import { logger } from "$lib/server/logger";

// Sentences are synthesized one at a time by the voice mode client, so a
// single request never needs to carry a whole essay.
const MAX_TEXT_LENGTH = 1_000;
const TTS_TIMEOUT = 60_000; // 60 seconds

const bodySchema = z.object({
	text: z
		.string()
		.transform((s) => s.trim())
		.pipe(z.string().min(1).max(MAX_TEXT_LENGTH)),
});

export async function POST({ request, locals }) {
	const ttsModel = config.get("TTS_MODEL");

	if (!ttsModel) {
		throw error(503, "Text-to-speech is not configured");
	}

	const token = getApiToken(locals);

	if (!token) {
		throw error(401, "Authentication required");
	}

	const parsed = bodySchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) {
		throw error(400, "Invalid request body, expected { text: string }");
	}

	const baseUrl = config.get("TTS_BASE_URL") || "https://router.huggingface.co/hf-inference/models";
	const apiUrl = `${baseUrl}/${ttsModel}`;
	const voice = config.get("TTS_VOICE");

	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), TTS_TIMEOUT);

	try {
		const response = await fetch(apiUrl, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
				// Bill to organization if configured
				...(locals?.billingOrganization ? { "X-HF-Bill-To": locals.billingOrganization } : {}),
			},
			body: JSON.stringify({
				inputs: parsed.data.text,
				...(voice ? { parameters: { voice } } : {}),
			}),
			signal: controller.signal,
		}).finally(() => clearTimeout(timeoutId));

		if (!response.ok) {
			const errorText = await response.text();
			logger.error({ status: response.status, error: errorText, model: ttsModel }, "TTS API error");
			throw error(response.status, "Speech synthesis failed");
		}

		return new Response(response.body, {
			headers: {
				"Content-Type": response.headers.get("content-type") ?? "audio/flac",
				"Cache-Control": "no-store",
			},
		});
	} catch (err) {
		if (err instanceof Error && err.name === "AbortError") {
			logger.error({ model: ttsModel }, "TTS timeout");
			throw error(504, "Speech synthesis took too long. Please try again.");
		}

		// Re-throw SvelteKit errors
		if (err && typeof err === "object" && "status" in err) {
			throw err;
		}

		logger.error(err, "TTS error");
		throw error(500, "Failed to synthesize speech");
	}
}
