import { authCondition } from "$lib/server/auth";
import { collections } from "$lib/server/database";
import type { SharedConversation } from "$lib/types/SharedConversation";
import { getShareUrl } from "$lib/utils/getShareUrl";
import { hashConv } from "$lib/utils/hashConv";
import { error } from "@sveltejs/kit";
import { ObjectId } from "mongodb";
import { nanoid } from "nanoid";

export async function POST({ params, url, locals }) {
	const conversation = await collections.conversations.findOne({
		_id: new ObjectId(params.id),
		...authCondition(locals),
	});

	if (!conversation) {
		throw error(404, "Conversation not found");
	}

	const hash = await hashConv(conversation);

	const existingShare = await collections.sharedConversations.findOne({ hash });

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
		createdAt: new Date(),
		messages: conversation.messages,
		hash,
		updatedAt: new Date(),
		title: conversation.title,
		model: conversation.model,
		preprompt: conversation.preprompt,
	};

	await collections.sharedConversations.insertOne(shared);

	// copy files from `${conversation._id}-` to `${shared._id}-`
	const files = await collections.bucket
		.find({ filename: { $regex: `${conversation._id}-` } })
		.toArray();

	await Promise.all(
		files.map(async (file) => {
			const newFilename = file.filename.replace(`${conversation._id}-`, `${shared._id}-`);
			// copy files from `${conversation._id}-` to `${shared._id}-` by downloading and reuploaidng
			const downloadStream = collections.bucket.openDownloadStream(file._id);
			const uploadStream = collections.bucket.openUploadStream(newFilename, {
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
