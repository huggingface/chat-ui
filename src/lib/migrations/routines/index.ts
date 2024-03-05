import type { MongoClient } from "mongodb";

import updateSearchAssistant from "./01-update-search-assistants";

export interface Migration {
	guid: ReturnType<typeof crypto.randomUUID>; // must be hardcoded randomUUID. Do not change it once pushed!
	name: string;
	up: (client: MongoClient) => Promise<boolean>;
	down?: (client: MongoClient) => Promise<boolean>;
	runForFreshInstall?: "only" | "never"; // leave unspecified to run for both
	runForHuggingChat?: "only" | "never"; // leave unspecified to run for both
}

export const migrations: Migration[] = [updateSearchAssistant];
