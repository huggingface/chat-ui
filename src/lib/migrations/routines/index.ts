import type { ObjectId } from "mongodb";

import updateSearchAssistant from "./01-update-search-assistants";
import updateAssistantsModels from "./02-update-assistants-models";
import type { Database } from "$lib/server/database";
import updateMessageUpdates from "./04-update-message-updates";
import updateMessageFiles from "./05-update-message-files";
import trimMessageUpdates from "./06-trim-message-updates";
import updateFeaturedToReview from "./08-update-featured-to-review";
import deleteEmptyConversations from "./09-delete-empty-conversations";
import updateReportsAssistantId from "./10-update-reports-assistantid";

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
	updateSearchAssistant,
	updateAssistantsModels,
	updateMessageUpdates,
	updateMessageFiles,
	trimMessageUpdates,
	updateFeaturedToReview,
	deleteEmptyConversations,
	updateReportsAssistantId,
];
