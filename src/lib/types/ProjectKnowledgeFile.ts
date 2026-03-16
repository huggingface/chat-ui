import type { ObjectId } from "mongodb";
import type { Timestamps } from "./Timestamps";

export interface ProjectKnowledgeFile extends Timestamps {
	_id: ObjectId;
	projectId: ObjectId;
	name: string;
	mime: string;
	sizeBytes: number;
	gridfsFileId: ObjectId;
	extractedText: string;
	charCount: number;
	chunkCount: number;
	embeddingStatus: "pending" | "processing" | "done" | "failed";
}
