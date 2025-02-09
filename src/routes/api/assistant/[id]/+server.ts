import { collections } from "$lib/server/database";
import { error } from "@sveltejs/kit";
import { ObjectId } from "mongodb";

export async function GET({ params }) {
	const id = params.id;
	const assistantId = new ObjectId(id);

	const assistant = await collections.assistants.findOne({
		_id: assistantId,
	});

	if (assistant) {
		return Response.json(assistant);
	} else {
		return Response.json({ message: "Assistant not found" }, { status: 404 });
	}
}

export async function DELETE({ params, locals }) {
	const assistant = await collections.assistants.findOne({ _id: new ObjectId(params.id) });

	if (!assistant) {
		return error(404, "Assistant not found");
	}

	if (
		assistant.createdById.toString() !== (locals.user?._id ?? locals.sessionId).toString() &&
		!locals.user?.isAdmin
	) {
		return error(403, "You are not the author of this assistant");
	}

	await collections.assistants.deleteOne({ _id: assistant._id });

	// and remove it from all users settings
	await collections.settings.updateMany(
		{
			assistants: { $in: [assistant._id] },
		},
		{
			$pull: { assistants: assistant._id },
		}
	);

	// and delete all avatars
	const fileCursor = collections.bucket.find({ filename: assistant._id.toString() });

	// Step 2: Delete the existing file if it exists
	let fileId = await fileCursor.next();
	while (fileId) {
		await collections.bucket.delete(fileId._id);
		fileId = await fileCursor.next();
	}

	return new Response("Assistant deleted", { status: 200 });
}
