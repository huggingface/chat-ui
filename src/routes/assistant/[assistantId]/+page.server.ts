import { base } from "$app/paths";
import { collections } from "$lib/server/database.js";
import { redirect } from "@sveltejs/kit";
import { ObjectId } from "mongodb";

export const load = async ({ params }) => {
	try {
		const assistant = await collections.assistants.findOne({
			_id: new ObjectId(params.assistantId),
		});

		if (!assistant) {
			throw redirect(302, `${base}`);
		}

		return { assistant: JSON.parse(JSON.stringify(assistant)) };
	} catch {
		throw redirect(302, `${base}`);
	}
};
