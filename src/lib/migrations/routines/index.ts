import type { MongoClient, ObjectId } from "mongodb";

import updateSearchAssistant from "./01-update-search-assistants";
import updateAssistantsModels from "./02-update-assistants-models";

export interface Migration {
	_id: ObjectId;
	name: string;
	up: (client: MongoClient) => Promise<boolean>;
	down?: (client: MongoClient) => Promise<boolean>;
	runForFreshInstall?: "only" | "never"; // leave unspecified to run for both
	runForHuggingChat?: "only" | "never"; // leave unspecified to run for both
	runEveryTime?: boolean;
}

export const migrations: Migration[] = [updateSearchAssistant, updateAssistantsModels];
