import type { ObjectId } from "mongodb";

export interface ProjectKnowledgeChunk {
	_id: ObjectId;
	fileId: ObjectId;
	projectId: ObjectId;
	index: number;
	text: string;
	embedding: number[];
}
