import type { ObjectId } from "mongodb";
import type { User } from "./User";
import type { Timestamps } from "./Timestamps";
import type { ReviewStatus } from "./Review";

export interface Assistant extends Timestamps {
	_id: ObjectId;
	createdById: User["_id"] | string; // user id or session
	createdByName?: User["username"];
	avatar?: string;
	name: string;
	description?: string;
	modelId: string;
	exampleInputs: string[];
	preprompt: string;
	userCount?: number;
	review: ReviewStatus;
	// Web search / RAG removed in this build
	generateSettings?: {
		temperature?: number;
		top_p?: number;
		repetition_penalty?: number;
		top_k?: number;
	};
	dynamicPrompt?: boolean;
	searchTokens: string[];
	last24HoursCount: number;
}

// eslint-disable-next-line no-shadow
export enum SortKey {
	POPULAR = "popular",
	TRENDING = "trending",
}
