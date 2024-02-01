import { collections } from "$lib/server/database";
import { type Actions, fail, redirect } from "@sveltejs/kit";
import { ObjectId } from "mongodb";
import { authCondition } from "$lib/server/auth";
import { base } from "$app/paths";

async function assistantOnlyIfAuthor(locals: App.Locals, assistantId?: string) {
	const assistant = await collections.assistants.findOne({ _id: new ObjectId(assistantId) });

	if (!assistant) {
		throw Error("Assistant not found");
	}

	if (assistant.createdById.toString() !== (locals.user?._id ?? locals.sessionId).toString()) {
		throw Error("You are not the author of this assistant");
	}

	return assistant;
}

export const actions: Actions = {
	delete: async ({ params, locals }) => {
		let assistant;
		try {
			assistant = await assistantOnlyIfAuthor(locals, params.assistantId);
		} catch (e) {
			return fail(400, { error: true, message: (e as Error).message });
		}

		await collections.assistants.deleteOne({ _id: assistant._id });

		// and remove it from all users settings
		await collections.settings.updateMany(
			{},
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

		throw redirect(302, `${base}/settings`);
	},
	report: async ({ params, locals }) => {
		// is there already a report from this user for this model ?
		const report = await collections.reports.findOne({
			assistantId: new ObjectId(params.assistantId),
			createdBy: locals.user?._id ?? locals.sessionId,
		});

		if (report) {
			return fail(400, { error: true, message: "Already reported" });
		}

		const { acknowledged } = await collections.reports.insertOne({
			_id: new ObjectId(),
			assistantId: new ObjectId(params.assistantId),
			createdBy: locals.user?._id ?? locals.sessionId,
			createdAt: new Date(),
			updatedAt: new Date(),
		});

		if (!acknowledged) {
			return fail(500, { error: true, message: "Failed to report assistant" });
		}
		return { from: "report", ok: true, message: "Assistant reported" };
	},

	subscribe: async ({ params, locals }) => {
		const assistant = await collections.assistants.findOne({
			_id: new ObjectId(params.assistantId),
		});

		if (!assistant) {
			return fail(404, { error: true, message: "Assistant not found" });
		}

		// don't push if it's already there
		const settings = await collections.settings.findOne(authCondition(locals));

		if (settings?.assistants?.includes(assistant._id)) {
			return fail(400, { error: true, message: "Already subscribed" });
		}

		const result = await collections.settings.updateOne(authCondition(locals), {
			$addToSet: { assistants: assistant._id },
		});

		// reduce count only if push succeeded
		if (result.modifiedCount > 0) {
			await collections.assistants.updateOne({ _id: assistant._id }, { $inc: { userCount: 1 } });
		}

		return { from: "subscribe", ok: true, message: "Assistant added" };
	},

	unsubscribe: async ({ params, locals }) => {
		const assistant = await collections.assistants.findOne({
			_id: new ObjectId(params.assistantId),
		});

		if (!assistant) {
			return fail(404, { error: true, message: "Assistant not found" });
		}

		const result = await collections.settings.updateOne(authCondition(locals), {
			$pull: { assistants: assistant._id },
		});

		// reduce count only if pull succeeded
		if (result.modifiedCount > 0) {
			await collections.assistants.updateOne({ _id: assistant._id }, { $inc: { userCount: -1 } });
		}

		throw redirect(302, `${base}/settings`);
	},
};
