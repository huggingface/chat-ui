import { collections } from "$lib/server/database";
import { type Actions, fail, redirect } from "@sveltejs/kit";
import { ObjectId } from "mongodb";
import { authCondition } from "$lib/server/auth";
import { base } from "$app/paths";
import { env as envPublic } from "$env/dynamic/public";
import { env } from "$env/dynamic/private";
import { z } from "zod";
import type { Assistant } from "$lib/types/Assistant";
import { ReviewStatus } from "$lib/types/Review";
import { sendSlack } from "$lib/server/sendSlack";

async function assistantOnlyIfAuthor(locals: App.Locals, assistantId?: string) {
	const assistant = await collections.assistants.findOne({ _id: new ObjectId(assistantId) });

	if (!assistant) {
		throw Error("Assistant not found");
	}

	if (
		assistant.createdById.toString() !== (locals.user?._id ?? locals.sessionId).toString() &&
		!locals.user?.isAdmin
	) {
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

		redirect(302, `${base}/settings`);
	},
	report: async ({ request, params, locals, url }) => {
		// is there already a report from this user for this model ?
		const report = await collections.reports.findOne({
			createdBy: locals.user?._id ?? locals.sessionId,
			object: "assistant",
			contentId: new ObjectId(params.assistantId),
		});

		if (report) {
			return fail(400, { error: true, message: "Already reported" });
		}

		const formData = await request.formData();
		const result = z.string().min(1).max(128).safeParse(formData?.get("reportReason"));

		if (!result.success) {
			return fail(400, { error: true, message: "Invalid report reason" });
		}

		const { acknowledged } = await collections.reports.insertOne({
			_id: new ObjectId(),
			contentId: new ObjectId(params.assistantId),
			object: "assistant",
			createdBy: locals.user?._id ?? locals.sessionId,
			createdAt: new Date(),
			updatedAt: new Date(),
			reason: result.data,
		});

		if (!acknowledged) {
			return fail(500, { error: true, message: "Failed to report assistant" });
		}

		if (env.WEBHOOK_URL_REPORT_ASSISTANT) {
			const prefixUrl =
				envPublic.PUBLIC_SHARE_PREFIX || `${envPublic.PUBLIC_ORIGIN || url.origin}${base}`;
			const assistantUrl = `${prefixUrl}/assistant/${params.assistantId}`;

			const assistant = await collections.assistants.findOne<Pick<Assistant, "name">>(
				{ _id: new ObjectId(params.assistantId) },
				{ projection: { name: 1 } }
			);

			const username = locals.user?.username;

			await sendSlack(
				`🔴 Assistant <${assistantUrl}|${assistant?.name}> reported by ${
					username ? `<http://hf.co/${username}|${username}>` : "non-logged in user"
				}.\n\n> ${result.data}`
			);
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

		redirect(302, `${base}/settings`);
	},
	deny: async ({ params, locals, url }) => {
		return await setReviewStatus({
			assistantId: params.assistantId,
			locals,
			status: ReviewStatus.DENIED,
			url,
		});
	},
	approve: async ({ params, locals, url }) => {
		return await setReviewStatus({
			assistantId: params.assistantId,
			locals,
			status: ReviewStatus.APPROVED,
			url,
		});
	},
	request: async ({ params, locals, url }) => {
		return await setReviewStatus({
			assistantId: params.assistantId,
			locals,
			status: ReviewStatus.PENDING,
			url,
		});
	},
	unrequest: async ({ params, locals, url }) => {
		return await setReviewStatus({
			assistantId: params.assistantId,
			locals,
			status: ReviewStatus.PRIVATE,
			url,
		});
	},
};

async function setReviewStatus({
	locals,
	assistantId,
	status,
	url,
}: {
	locals: App.Locals;
	assistantId?: string;
	status: ReviewStatus;
	url: URL;
}) {
	if (!assistantId) {
		return fail(400, { error: true, message: "Assistant ID is required" });
	}

	const assistant = await collections.assistants.findOne({
		_id: new ObjectId(assistantId),
	});

	if (!assistant) {
		return fail(404, { error: true, message: "Assistant not found" });
	}

	if (
		!locals.user ||
		(!locals.user.isAdmin && assistant.createdById.toString() !== locals.user._id.toString())
	) {
		return fail(403, { error: true, message: "Permission denied" });
	}

	// only admins can set the status to APPROVED or DENIED
	// if the status is already APPROVED or DENIED, only admins can change it

	if (
		(status === ReviewStatus.APPROVED ||
			status === ReviewStatus.DENIED ||
			assistant.review === ReviewStatus.APPROVED ||
			assistant.review === ReviewStatus.DENIED) &&
		!locals.user?.isAdmin
	) {
		return fail(403, { error: true, message: "Permission denied" });
	}

	const result = await collections.assistants.updateOne(
		{ _id: assistant._id },
		{ $set: { review: status } }
	);

	if (result.modifiedCount === 0) {
		return fail(500, { error: true, message: "Failed to update review status" });
	}

	if (status === ReviewStatus.PENDING) {
		const prefixUrl =
			envPublic.PUBLIC_SHARE_PREFIX || `${envPublic.PUBLIC_ORIGIN || url.origin}${base}`;
		const assistantUrl = `${prefixUrl}/assistant/${assistantId}`;

		const username = locals.user?.username;

		await sendSlack(
			`🟢 Assistant <${assistantUrl}|${assistant?.name}> requested to be featured by ${
				username ? `<http://hf.co/${username}|${username}>` : "non-logged in user"
			}.`
		);
	}

	return { from: "setReviewStatus", ok: true, message: "Review status updated" };
}
