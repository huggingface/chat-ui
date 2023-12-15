import { collections } from "$lib/server/database.js";
import { ObjectId } from "mongodb";

export const load = async ({ params }) => {
	const assistant = await collections.assistants.findOne({
		_id: new ObjectId(params.assistantId),
	});

	return { assistant: JSON.parse(JSON.stringify(assistant)) };
	// throw redirect(302, `${base}/settings/assistants/` + params.assistantId);
};
