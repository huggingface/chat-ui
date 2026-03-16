import { ObjectId } from "mongodb";
import { collections } from "$lib/server/database";
import { logger } from "$lib/server/logger";
import { config } from "$lib/server/config";
import { chunkText } from "./chunk";
import { embedTexts } from "./embed";

/**
 * Chunk a file's extracted text and generate embeddings.
 * Called async after file upload — does not block the upload response.
 */
export async function embedFileChunks(fileId: ObjectId): Promise<void> {
	const file = await collections.projectKnowledgeFiles.findOne({ _id: fileId });
	if (!file) {
		logger.warn({ fileId }, "embedFileChunks: file not found");
		return;
	}

	try {
		await collections.projectKnowledgeFiles.updateOne(
			{ _id: fileId },
			{ $set: { embeddingStatus: "processing" } }
		);

		const chunkSize = parseInt(config.PROJECT_KNOWLEDGE_CHUNK_SIZE || "1000", 10);
		const chunkOverlap = parseInt(config.PROJECT_KNOWLEDGE_CHUNK_OVERLAP || "200", 10);

		const chunks = chunkText(file.extractedText, chunkSize, chunkOverlap);
		if (chunks.length === 0) {
			await collections.projectKnowledgeFiles.updateOne(
				{ _id: fileId },
				{ $set: { embeddingStatus: "done", chunkCount: 0 } }
			);
			return;
		}

		// Batch embed — TEI handles batching internally, but keep batches reasonable
		const BATCH_SIZE = 32;
		const allEmbeddings: number[][] = [];

		for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
			const batch = chunks.slice(i, i + BATCH_SIZE);
			const embeddings = await embedTexts(batch);
			allEmbeddings.push(...embeddings);
		}

		// Insert chunk documents
		const chunkDocs = chunks.map((text, i) => ({
			_id: new ObjectId(),
			fileId,
			projectId: file.projectId,
			index: i,
			text,
			embedding: allEmbeddings[i],
		}));

		await collections.projectKnowledgeChunks.insertMany(chunkDocs);

		await collections.projectKnowledgeFiles.updateOne(
			{ _id: fileId },
			{ $set: { embeddingStatus: "done", chunkCount: chunks.length } }
		);

		logger.info({ fileId, chunkCount: chunks.length }, "embedFileChunks: completed");
	} catch (err) {
		logger.error({ fileId, err }, "embedFileChunks: failed");
		await collections.projectKnowledgeFiles
			.updateOne({ _id: fileId }, { $set: { embeddingStatus: "failed" } })
			.catch(() => {});
	}
}
