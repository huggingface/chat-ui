import type { ObjectId } from "mongodb";
import type { User } from "./User";
import type { Timestamps } from "./Timestamps";

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
	featured?: boolean;
	rag?: {
		allowAllDomains: boolean;
		allowedDomains: string[];
		allowedLinks: string[];
	};
	dynamicPrompt?: boolean;
	searchTokens: string[];
	last24HoursCount?: {
		count: number; // total number of requests an assistant received over the last 24 hours
		byHour: Partial<Record<string, number>>; // number of requests an assistant received by hour (ex: `2: n` means from 01:00-02:00 there were n requests)
	};
}

// eslint-disable-next-line no-shadow
export enum SortKey {
	POPULAR = "popular",
	TRENDING = "trending",
}
