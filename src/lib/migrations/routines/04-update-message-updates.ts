import type { Migration } from ".";
import { collections } from "$lib/server/database";
import { ObjectId, type WithId } from "mongodb";
import type { Conversation } from "$lib/types/Conversation";
// Simple type to replace removed WebSearchSource for migration compatibility
type WebSearchSource = {
	title?: string;
	link: string;
};
import {
	MessageUpdateStatus,
	MessageUpdateType,
	type MessageUpdate,
} from "$lib/types/MessageUpdate";

// Legacy types for migration compatibility
enum MessageWebSearchUpdateType {
	Update = "update",
	Error = "error",
	Sources = "sources",
	Finished = "finished",
}

type MessageWebSearchFinishedUpdate = {
	type: "webSearch";
	subtype: MessageWebSearchUpdateType.Finished;
};
import type { Message } from "$lib/types/Message";
// isMessageWebSearchSourcesUpdate removed from utils; use inline predicate

// -----------
// Copy of the previous message update types
export type FinalAnswer = {
	type: "finalAnswer";
	text: string;
};

export type TextStreamUpdate = {
	type: "stream";
	token: string;
};

type WebSearchUpdate = {
	type: "webSearch";
	messageType: "update" | "error" | "sources";
	message: string;
	args?: string[];
	sources?: WebSearchSource[];
};

type StatusUpdate = {
	type: "status";
	status: "started" | "pending" | "finished" | "error" | "title";
	message?: string;
};

type ErrorUpdate = {
	type: "error";
	message: string;
	name: string;
};

type FileUpdate = {
	type: "file";
	sha: string;
};

type OldMessageUpdate =
	| FinalAnswer
	| TextStreamUpdate
	| WebSearchUpdate
	| StatusUpdate
	| ErrorUpdate
	| FileUpdate;

/** Converts the old message update to the new schema */
function convertMessageUpdate(message: Message, update: OldMessageUpdate): MessageUpdate | null {
	try {
		// Text and files
		if (update.type === "finalAnswer") {
			return {
				type: MessageUpdateType.FinalAnswer,
				text: update.text,
				interrupted: message.interrupted ?? false,
			};
		} else if (update.type === "stream") {
			return {
				type: MessageUpdateType.Stream,
				token: update.token,
			};
		} else if (update.type === "file") {
			return {
				type: MessageUpdateType.File,
				name: "Unknown",
				sha: update.sha,
				// assume jpeg but could be any image. should be harmless
				mime: "image/jpeg",
			};
		}

		// Status
		else if (update.type === "status") {
			if (update.status === "title") {
				return {
					type: MessageUpdateType.Title,
					title: update.message ?? "New Chat",
				};
			}
			if (update.status === "pending") return null;

			const status =
				update.status === "started"
					? MessageUpdateStatus.Started
					: update.status === "finished"
						? MessageUpdateStatus.Finished
						: MessageUpdateStatus.Error;
			return {
				type: MessageUpdateType.Status,
				status,
				message: update.message,
			};
		} else if (update.type === "error") {
			// Treat it as an error status update
			return {
				type: MessageUpdateType.Status,
				status: MessageUpdateStatus.Error,
				message: update.message,
			};
		}

		// Web Search
		else if (update.type === "webSearch") {
			if (update.messageType === "update") {
				return {
					type: MessageUpdateType.WebSearch,
					subtype: MessageWebSearchUpdateType.Update,
					message: update.message,
					args: update.args,
				};
			} else if (update.messageType === "error") {
				return {
					type: MessageUpdateType.WebSearch,
					subtype: MessageWebSearchUpdateType.Error,
					message: update.message,
					args: update.args,
				};
			} else if (update.messageType === "sources") {
				return {
					type: MessageUpdateType.WebSearch,
					subtype: MessageWebSearchUpdateType.Sources,
					message: update.message,
					sources: update.sources ?? [],
				};
			}
		}
		console.warn("Unknown message update during migration:", update);
		return null;
	} catch (error) {
		console.error("Error converting message update during migration. Skipping it... Error:", error);
		return null;
	}
}

const updateMessageUpdates: Migration = {
	_id: new ObjectId("5f9f7f7f7f7f7f7f7f7f7f7f"),
	name: "Convert message updates to the new schema",
	up: async () => {
		const allConversations = collections.conversations.find({});

		let conversation: WithId<Pick<Conversation, "messages">> | null = null;
		while ((conversation = await allConversations.tryNext())) {
			const messages = conversation.messages.map((message) => {
				// Convert all of the existing updates to the new schema
				const updates = message.updates
					?.map((update) => convertMessageUpdate(message, update as OldMessageUpdate))
					.filter((update): update is MessageUpdate => Boolean(update));

				// Add the new web search finished update if the sources update exists and webSearch is defined
				const webSearchSourcesUpdateIndex =
					updates?.findIndex(
						(u) =>
							u.type === MessageUpdateType.WebSearch &&
							u.subtype === MessageWebSearchUpdateType.Sources
					) ?? -1;
				if (message.webSearch && updates && webSearchSourcesUpdateIndex !== -1) {
					const webSearchFinishedUpdate: MessageWebSearchFinishedUpdate = {
						type: MessageUpdateType.WebSearch,
						subtype: MessageWebSearchUpdateType.Finished,
					};
					updates.splice(webSearchSourcesUpdateIndex + 1, 0, webSearchFinishedUpdate);
				}
				return { ...message, updates };
			});

			// Set the new messages array
			await collections.conversations.updateOne({ _id: conversation._id }, { $set: { messages } });
		}

		return true;
	},
	runEveryTime: false,
};

export default updateMessageUpdates;
