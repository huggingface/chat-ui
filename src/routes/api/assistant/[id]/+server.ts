import { collections } from "$lib/server/database";
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
