import { collections } from "$lib/server/database";
import { MetricsServer } from "$lib/server/metrics";
import { error } from "@sveltejs/kit";
import { ObjectId } from "mongodb";
import { authCondition } from "$lib/server/auth";
import { sanitizeShareId } from "$lib/server/mongoSanitize";

/**
 * Create a new conversation from a shared conversation ID.
 * If the conversation already exists for the user/session, return the existing conversation ID.
 * returns the conversation ID.
 */
export async function createConversationFromShare(
	fromShareId: string,
	locals: App.Locals,
	userAgent?: string
): Promise<string> {
	// Sanitize the share ID to prevent NoSQL injection
	const safeShareId = sanitizeShareId(fromShareId);
	if (!safeShareId) {
		error(400, "Invalid share ID");
	}

	const conversation = await collections.sharedConversations.findOne({
		_id: safeShareId,
	});

	if (!conversation) {
		error(404, "Conversation not found");
	}

	// Check if shared conversation exists already for this user/session
	const existingConversation = await collections.conversations.findOne({
		"meta.fromShareId": safeShareId,
		...authCondition(locals),
	});

	if (existingConversation) {
		return existingConversation._id.toString();
	}

	// Create new conversation from shared conversation
	const res = await collections.conversations.insertOne({
		_id: new ObjectId(),
		title: conversation.title.replace(/<\/?think>/gi, "").trim(),
		rootMessageId: conversation.rootMessageId,
		messages: conversation.messages,
		model: conversation.model,
		preprompt: conversation.preprompt,
		createdAt: new Date(),
		updatedAt: new Date(),
		userAgent,
		...(locals.user ? { userId: locals.user._id } : { sessionId: locals.sessionId }),
		meta: { fromShareId: safeShareId },
	});

	// Copy files from shared conversation bucket entries to the new conversation
	// Shared files are stored with filenames "${sharedId}-${sha}" and metadata.conversation = sharedId
	// New conversation expects files to be stored under its own id prefix
	const newConvId = res.insertedId.toString();
	const sharedId = safeShareId;
	const files = await collections.bucket.find({ filename: { $regex: `^${sharedId}-` } }).toArray();

	await Promise.all(
		files.map(
			(file) =>
				new Promise<void>((resolve, reject) => {
					try {
						const newFilename = file.filename.replace(`${sharedId}-`, `${newConvId}-`);
						const downloadStream = collections.bucket.openDownloadStream(file._id);
						const uploadStream = collections.bucket.openUploadStream(newFilename, {
							metadata: { ...file.metadata, conversation: newConvId },
						});
						downloadStream
							.on("error", reject)
							.pipe(uploadStream)
							.on("error", reject)
							.on("finish", () => resolve());
					} catch (e) {
						reject(e);
					}
				})
		)
	);

	if (MetricsServer.isEnabled()) {
		MetricsServer.getMetrics().model.conversationsTotal.inc({ model: conversation.model });
	}
	return res.insertedId.toString();
}
