import type { ObjectId } from "mongodb";
import type { Timestamps } from "./Timestamps";
import type { EmbeddingEndpoint } from "./EmbeddingEndpoint";

export interface EmbeddingModel extends Timestamps {
	_id: ObjectId;

	name: string;

	description?: string;
	websiteUrl?: string;
	modelUrl?: string;

	chunkCharLength: number;
	maxBatchSize?: number;

	preQuery: string;
	prePassage: string;

	endpoints: EmbeddingEndpoint[];
}
