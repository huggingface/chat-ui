import type { ObjectId } from "mongodb";

import updateSearchAssistant from "./01-update-search-assistants";
import updateAssistantsModels from "./02-update-assistants-models";
import type { MongoDBClient } from "$lib/server/database";

export interface Migration {
	_id: ObjectId;
	name: string;
	up: (client: MongoDBClient) => Promise<boolean>;
	down?: (client: MongoDBClient) => Promise<boolean>;
	runForFreshInstall?: "only" | "never"; // leave unspecified to run for both
	runForHuggingChat?: "only" | "never"; // leave unspecified to run for both
	runEveryTime?: boolean;
}

export const migrations: Migration[] = [updateSearchAssistant, updateAssistantsModels];
