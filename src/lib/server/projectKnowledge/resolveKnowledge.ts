import type { ObjectId } from "mongodb";
import { collections } from "$lib/server/database";
import { config } from "$lib/server/config";
import { embedTexts, cosineSimilarity, isTeiAvailable } from "./embed";
import { logger } from "$lib/server/logger";

/**
 * Resolve project knowledge to inject into the system prompt.
 *
 * - Tier 1 (context stuffing): if total chars ≤ threshold or no TEI, concat all file texts
 * - Tier 2 (chunk + retrieve): embed user message, find top-K similar chunks
 *
 * Returns undefined if the project has no knowledge files.
 */
export async function resolveProjectKnowledge(
	projectId: ObjectId,
	userMessage: string
): Promise<string | undefined> {
	const files = await collections.projectKnowledgeFiles
		.find({ projectId })
		.project({ _id: 1, name: 1, extractedText: 1, charCount: 1, embeddingStatus: 1 })
		.toArray();

	if (files.length === 0) return undefined;

	const totalChars = files.reduce((sum, f) => sum + (f.charCount ?? 0), 0);
	if (totalChars === 0) return undefined;

	const threshold = parseInt(config.PROJECT_KNOWLEDGE_CHAR_THRESHOLD || "50000", 10);
	const topK = parseInt(config.PROJECT_KNOWLEDGE_TOP_K || "5", 10);

	// Tier 1: context stuffing (small knowledge or no TEI)
	if (totalChars <= threshold || !isTeiAvailable()) {
		const blocks = files
			.filter((f) => f.extractedText)
			.map((f) => `[Source: ${f.name}]\n${f.extractedText}`);

		return wrapKnowledge(blocks.join("\n\n"));
	}

	// Tier 2: chunk + retrieve
	try {
		const queryEmbedding = (await embedTexts([userMessage]))[0];

		const chunks = await collections.projectKnowledgeChunks.find({ projectId }).toArray();

		if (chunks.length === 0) {
			// Embeddings not ready yet — fall back to Tier 1
			const blocks = files
				.filter((f) => f.extractedText)
				.map((f) => `[Source: ${f.name}]\n${f.extractedText}`);
			return wrapKnowledge(blocks.join("\n\n"));
		}

		// Score chunks by cosine similarity
		const scored = chunks
			.filter((c) => c.embedding?.length > 0)
			.map((c) => ({
				...c,
				score: cosineSimilarity(queryEmbedding, c.embedding),
			}))
			.sort((a, b) => b.score - a.score)
			.slice(0, topK);

		if (scored.length === 0) return undefined;

		// Build file ID → name lookup
		const fileNameMap = new Map(files.map((f) => [f._id.toString(), f.name]));

		const blocks = scored.map((c) => {
			const fileName = fileNameMap.get(c.fileId.toString()) ?? "unknown";
			return `[Source: ${fileName}]\n${c.text}`;
		});

		return wrapKnowledge(blocks.join("\n\n"));
	} catch (err) {
		logger.error(
			{ projectId, err },
			"resolveProjectKnowledge: Tier 2 failed, falling back to Tier 1"
		);
		// Fallback to Tier 1
		const blocks = files
			.filter((f) => f.extractedText)
			.map((f) => `[Source: ${f.name}]\n${f.extractedText}`);
		return wrapKnowledge(blocks.join("\n\n"));
	}
}

function wrapKnowledge(content: string): string {
	return `<project-knowledge>\n${content}\n</project-knowledge>`;
}
