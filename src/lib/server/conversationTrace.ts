import type { ObjectId } from "mongodb";
import { collections } from "$lib/server/database";
import type { Conversation } from "$lib/types/Conversation";
import { readReferencedToolImages } from "$lib/server/files/toolImages";

export const TRACE_FORMAT_VERSION = 1;

const TITLE_SLUG_MAX = 60;

export function slugify(text: string): string {
	return text
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.slice(0, TITLE_SLUG_MAX)
		.replace(/^-+|-+$/g, "");
}

export function traceFilename(id: string, title: string): string {
	const slug = slugify(title);
	return `${slug ? `${id}-${slug}` : id}.json`;
}

type Row = { _id: ObjectId; conversationId?: ObjectId };

const withId = <T extends Row>({ _id, conversationId: _conversationId, ...row }: T) => ({
	id: _id.toString(),
	...row,
});

/** everything stored for the conversation, unlike the pane endpoints nothing is projected away */
export async function buildConversationTrace(
	conversationId: ObjectId,
	conversation: Pick<
		Conversation,
		"title" | "model" | "preprompt" | "createdAt" | "updatedAt" | "rootMessageId" | "messages"
	> &
		Partial<Pick<Conversation, "mlAssistant" | "mlBudget" | "plan" | "historyWindow">>
) {
	const [services, artefacts, agentRuns, agentCalls, sources, files, toolImages] =
		await Promise.all([
			collections.mlServices.find({ conversationId }).sort({ createdAt: 1, _id: 1 }).toArray(),
			collections.mlArtefacts.find({ conversationId }).sort({ createdAt: 1, _id: 1 }).toArray(),
			collections.mlAgentRuns.find({ conversationId }).sort({ startedAt: 1, _id: 1 }).toArray(),
			collections.nestedAgentCalls
				.find({ conversationId })
				.sort({ createdAt: 1, _id: 1 })
				.toArray(),
			collections.mlSources.find({ conversationId }).sort({ firstSeenAt: 1, _id: 1 }).toArray(),
			collections.mlFiles.find({ conversationId }).sort({ name: 1, version: 1 }).toArray(),
			readReferencedToolImages(conversationId, conversation.messages),
		]);

	return {
		format: "chat-ui-conversation-trace",
		version: TRACE_FORMAT_VERSION,
		exportedAt: new Date(),
		conversation: {
			id: conversationId.toString(),
			title: conversation.title,
			model: conversation.model,
			preprompt: conversation.preprompt,
			createdAt: conversation.createdAt,
			updatedAt: conversation.updatedAt,
			mlAssistant: conversation.mlAssistant,
			mlBudget: conversation.mlBudget,
			plan: conversation.plan,
			historyWindow: conversation.historyWindow,
			rootMessageId: conversation.rootMessageId,
			messages: conversation.messages,
		},
		services: services.map(withId),
		artefacts: artefacts.map(withId),
		agentRuns: agentRuns.map(withId),
		// every call a sub-agent made, runs keep only the first ones but these expire after 24 hours
		agentCalls: agentCalls.map(withId),
		sources: sources.map(withId),
		files: files.map(withId),
		// messages reference these by sha, data is null when the stored file is gone
		toolImages,
	};
}
