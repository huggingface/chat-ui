import { config } from "$lib/server/config";
import { logger } from "$lib/server/logger";

/**
 * Embed texts using HuggingFace Text Embeddings Inference (TEI).
 * Requires TEI_ENDPOINT to be configured.
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
	const endpoint = config.TEI_ENDPOINT;
	if (!endpoint) {
		throw new Error("TEI_ENDPOINT not configured — cannot generate embeddings");
	}

	const res = await fetch(`${endpoint}/embed`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ inputs: texts, truncate: true }),
	});

	if (!res.ok) {
		const body = await res.text().catch(() => "");
		logger.error({ status: res.status, body }, "TEI embedding request failed");
		throw new Error(`TEI embedding failed: ${res.status}`);
	}

	return res.json() as Promise<number[][]>;
}

/**
 * Returns true if a TEI endpoint is configured and available.
 */
export function isTeiAvailable(): boolean {
	return Boolean(config.TEI_ENDPOINT);
}

/**
 * Compute cosine similarity between two vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
	let dot = 0;
	let normA = 0;
	let normB = 0;
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i];
		normA += a[i] * a[i];
		normB += b[i] * b[i];
	}
	const denom = Math.sqrt(normA) * Math.sqrt(normB);
	return denom === 0 ? 0 : dot / denom;
}
