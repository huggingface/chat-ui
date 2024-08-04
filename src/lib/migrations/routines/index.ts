import type { ObjectId } from "mongodb";

import updateSearchAssistant from "./01-update-search-assistants";
import updateAssistantsModels from "./02-update-assistants-models";
import type { Database } from "$lib/server/database";
import addToolsToSettings from "./03-add-tools-in-settings";
import updateMessageUpdates from "./04-update-message-updates";
import updateMessageFiles from "./05-update-message-files";
import trimMessageUpdates from "./06-trim-message-updates";
import updateConversationsSharedBool from "./91-update-conversations-shared-bool";

import resetTools from "./07-reset-tools-in-settings";

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
	addToolsToSettings,
	updateMessageUpdates,
	updateMessageFiles,
	trimMessageUpdates,
	updateConversationsSharedBool,

	resetTools,
];
