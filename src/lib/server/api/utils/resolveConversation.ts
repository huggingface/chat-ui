import { collections } from "$lib/server/database";
import { ObjectId } from "mongodb";
import { authCondition } from "$lib/server/auth";
import { convertLegacyConversation } from "$lib/utils/tree/convertLegacyConversation";
import { error } from "@sveltejs/kit";
import type { Conversation } from "$lib/types/Conversation";
import type { SharedConversation } from "$lib/types/SharedConversation";

// no _id so a share id never reaches new ObjectId, which throws synchronously
export type ResolvedConversation =
	| (Omit<SharedConversation, "_id"> & { kind: "share"; id: string; shared: true })
	| (Omit<Conversation, "_id"> & {
			kind: "owned";
			id: string;
			objectId: ObjectId;
			shared: boolean;
	  });

/**
 * Resolve a conversation by ID.
 * - 7-char IDs → shared conversation lookup
 * - ObjectId strings → owned conversation lookup with auth check
 *
 * Returns the conversation with legacy fields converted and a `shared` flag.
 */
export async function resolveConversation(
	id: string,
	locals: App.Locals,
	fromShare?: string | null
): Promise<ResolvedConversation> {
	if (id.length === 7) {
		// shared link of length 7
		const conversation = await collections.sharedConversations.findOne({
			_id: id,
		});
		if (!conversation) {
			error(404, "Conversation not found");
		}
		const { _id, ...rest } = conversation;
		return {
			...rest,
			...convertLegacyConversation(rest),
			kind: "share",
			id: _id,
			shared: true,
		};
	}

	try {
		new ObjectId(id);
	} catch {
		error(400, "Invalid conversation ID format");
	}

	const conversation = await collections.conversations.findOne({
		_id: new ObjectId(id),
		...authCondition(locals),
	});

	if (!conversation) {
		const conversationExists =
			(await collections.conversations.countDocuments({
				_id: new ObjectId(id),
			})) !== 0;

		if (conversationExists) {
			error(
				403,
				"You don't have access to this conversation. If someone gave you this link, ask them to use the 'share' feature instead."
			);
		}

		error(404, "Conversation not found.");
	}

	const { _id, ...rest } = conversation;
	return {
		...rest,
		...convertLegacyConversation(rest),
		kind: "owned",
		id: _id.toString(),
		objectId: _id,
		shared: Boolean(fromShare && conversation.meta?.fromShareId === fromShare),
	};
}
