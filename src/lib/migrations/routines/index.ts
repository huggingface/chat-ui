import type { MongoClient, ObjectId } from "mongodb";

import updateSearchAssistant from "./01-update-search-assistants";

export interface Migration {
	_id: ObjectId;
	name: string;
	up: (client: MongoClient) => Promise<boolean>;
	down?: (client: MongoClient) => Promise<boolean>;
	runForFreshInstall?: "only" | "never"; // leave unspecified to run for both
	runForHuggingChat?: "only" | "never"; // leave unspecified to run for both
}

export const migrations: Migration[] = [updateSearchAssistant];
