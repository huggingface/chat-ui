import { authCondition } from "$lib/server/auth";
import { Database } from "$lib/server/database";
import type { SharedConversation } from "$lib/types/SharedConversation";
import { getShareUrl } from "$lib/utils/getShareUrl";
import { hashConv } from "$lib/utils/hashConv";
import { error } from "@sveltejs/kit";
import { ObjectId } from "mongodb";
import { nanoid } from "nanoid";

export async function POST({ params, url, locals }) {
	const conversation = await Database.getInstance().getCollections().conversations.findOne({
		_id: new ObjectId(params.id),
		...authCondition(locals),
	});

	if (!conversation) {
		throw error(404, "Conversation not found");
	}

	const hash = await hashConv(conversation);

	const existingShare = await Database.getInstance().getCollections().sharedConversations.findOne({ hash });

	if (existingShare) {
		return new Response(
			JSON.stringify({
				url: getShareUrl(url, existingShare._id),
			}),
			{ headers: { "Content-Type": "application/json" } }
		);
	}

	const shared: SharedConversation = {
		_id: nanoid(7),
		hash,
		createdAt: new Date(),
		updatedAt: new Date(),
		rootMessageId: conversation.rootMessageId,
		messages: conversation.messages,
		title: conversation.title,
		model: conversation.model,
		embeddingModel: conversation.embeddingModel,
		preprompt: conversation.preprompt,
		assistantId: conversation.assistantId,
	};

	await Database.getInstance().getCollections().sharedConversations.insertOne(shared);

	// copy files from `${conversation._id}-` to `${shared._id}-`
	const files = await Database.getInstance().getCollections().bucket
		.find({ filename: { $regex: `${conversation._id}-` } })
		.toArray();

	await Promise.all(
		files.map(async (file) => {
			const newFilename = file.filename.replace(`${conversation._id}-`, `${shared._id}-`);
			// copy files from `${conversation._id}-` to `${shared._id}-` by downloading and reuploaidng
			const downloadStream = Database.getInstance().getCollections().bucket.openDownloadStream(file._id);
			const uploadStream = Database.getInstance().getCollections().bucket.openUploadStream(newFilename, {
				metadata: { ...file.metadata, conversation: shared._id.toString() },
			});
			downloadStream.pipe(uploadStream);
		})
	);

	return new Response(
		JSON.stringify({
			url: getShareUrl(url, shared._id),
		}),
		{ headers: { "Content-Type": "application/json" } }
	);
}
