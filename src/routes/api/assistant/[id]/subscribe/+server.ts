import { authCondition } from "$lib/server/auth";

import { collections } from "$lib/server/database";
import { defaultModel } from "$lib/server/models.js";
import { error } from "@sveltejs/kit";
import { ObjectId } from "mongodb";

export async function POST({ params, locals }) {
	const assistant = await collections.assistants.findOne({
		_id: new ObjectId(params.id),
	});

	if (!assistant) {
		return error(404, "Assistant not found");
	}

	// don't push if it's already there
	const settings = await collections.settings.findOne(authCondition(locals));

	if (settings?.assistants?.includes(assistant._id)) {
		return error(400, "Already subscribed");
	}

	const result = await collections.settings.updateOne(authCondition(locals), {
		$addToSet: { assistants: assistant._id },
		$set: { activeModel: assistant._id.toString() },
	});

	// reduce count only if push succeeded
	if (result.modifiedCount > 0) {
		await collections.assistants.updateOne({ _id: assistant._id }, { $inc: { userCount: 1 } });
	}

	return new Response("Assistant subscribed", { status: 200 });
}

export async function DELETE({ params, locals }) {
	const assistant = await collections.assistants.findOne({
		_id: new ObjectId(params.id),
	});

	if (!assistant) {
		return error(404, "Assistant not found");
	}

	const result = await collections.settings.updateOne(authCondition(locals), {
		$pull: { assistants: assistant._id },
	});

	// reduce count only if pull succeeded
	if (result.modifiedCount > 0) {
		await collections.assistants.updateOne({ _id: assistant._id }, { $inc: { userCount: -1 } });
	}

	const settings = await collections.settings.findOne(authCondition(locals));

	// if the assistant was the active model, set the default model as active
	if (settings?.activeModel === assistant._id.toString()) {
		await collections.settings.updateOne(authCondition(locals), {
			$set: { activeModel: defaultModel.id },
		});
	}

	return new Response("Assistant unsubscribed", { status: 200 });
}
