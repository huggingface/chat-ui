import type { ObjectId } from "mongodb";

import type { Database } from "$lib/server/database";
import updateMessageUpdates from "./04-update-message-updates";
import updateMessageFiles from "./05-update-message-files";
import trimMessageUpdates from "./06-trim-message-updates";
import deleteEmptyConversations from "./09-delete-empty-conversations";

export interface Migration {
	_id: ObjectId;
	name: string;
	up: (client: Database) => Promise<boolean>;
	down?: (client: Database) => Promise<boolean>;
	runForFreshInstall?: "only" | "never"; // leave unspecified to run for both
	runForHuggingChat?: "only" | "never"; // leave unspecified to run for both
	runEveryTime?: boolean;
}

export const migrations: Migration[] = [
	updateMessageUpdates,
	updateMessageFiles,
	trimMessageUpdates,
	deleteEmptyConversations,
];
