import { authCondition } from "$lib/server/auth";
import { collections } from "$lib/server/database";
import { error } from "@sveltejs/kit";
import { ObjectId } from "mongodb";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ locals, params }) => {
	const convId = new ObjectId(params.id);

	// Check if user has access to this conversation
	const conv = await collections.conversations.findOne({
		_id: convId,
		...authCondition(locals),
	});

	if (!conv) {
		error(404, "Conversation not found");
	}

	// Format the conversation data for export
	const exportData = {
		id: conv._id.toString(),
		title: conv.title,
		model: conv.model,
		messages: conv.messages.map((message) => ({
			id: message.id,
			from: message.from,
			content: message.content,
			createdAt: message.createdAt,
			updatedAt: message.updatedAt,
			files: message.files,
			ancestors: message.ancestors,
			children: message.children,
			...(message.routerMetadata && { routerMetadata: message.routerMetadata }),
		})),
		preprompt: conv.preprompt,
		createdAt: conv.createdAt,
		updatedAt: conv.updatedAt,
		exportedAt: new Date().toISOString(),
	};

	// Create a safe filename from the conversation title
	const safeTitle = conv.title
		.replace(/[^a-z0-9]/gi, "_")
		.toLowerCase()
		.substring(0, 50);
	const date = new Date().toISOString().split("T")[0];
	const filename = `conversation-${safeTitle}-${date}.json`;

	// Return the JSON file as a download
	return new Response(JSON.stringify(exportData, null, 2), {
		headers: {
			"Content-Type": "application/json",
			"Content-Disposition": `attachment; filename="${filename}"`,
		},
	});
};
