import { base } from "$app/paths";
import { env } from "$env/dynamic/private";
import { env as envPublic } from "$env/dynamic/public";
import { collections } from "$lib/server/database";
import { sendSlack } from "$lib/server/sendSlack";
import { ReviewStatus } from "$lib/types/Review";
import type { Tool } from "$lib/types/Tool";
import { fail, redirect, type Actions } from "@sveltejs/kit";
import { ObjectId } from "mongodb";
import { z } from "zod";

async function toolOnlyIfAuthor(locals: App.Locals, toolId?: string) {
	const tool = await collections.tools.findOne({ _id: new ObjectId(toolId) });

	if (!tool) {
		throw Error("Tool not found");
	}

	if (
		tool.createdById.toString() !== (locals.user?._id ?? locals.sessionId).toString() &&
		!locals.user?.isAdmin
	) {
		throw Error("You are not the creator of this tool");
	}

	return tool;
}

export const actions: Actions = {
	delete: async ({ params, locals }) => {
		let tool;
		try {
			tool = await toolOnlyIfAuthor(locals, params.toolId);
		} catch (e) {
			return fail(400, { error: true, message: (e as Error).message });
		}

		await collections.tools.deleteOne({ _id: tool._id });

		// Remove the tool from all users' settings
		await collections.settings.updateMany(
			{
				tools: { $in: [tool._id.toString()] },
			},
			{
				$pull: { tools: tool._id.toString() },
			}
		);

		// Remove the tool from all assistants
		await collections.assistants.updateMany(
			{
				tools: { $in: [tool._id.toString()] },
			},
			{
				$pull: { tools: tool._id.toString() },
			}
		);

		redirect(302, `${base}/tools`);
	},
	report: async ({ request, params, locals, url }) => {
		// is there already a report from this user for this model ?
		const report = await collections.reports.findOne({
			createdBy: locals.user?._id ?? locals.sessionId,
			object: "tool",
			contentId: new ObjectId(params.toolId),
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
			contentId: new ObjectId(params.toolId),
			object: "tool",
			createdBy: locals.user?._id ?? locals.sessionId,
			createdAt: new Date(),
			updatedAt: new Date(),
			reason: result.data,
		});

		if (!acknowledged) {
			return fail(500, { error: true, message: "Failed to report tool" });
		}

		if (env.WEBHOOK_URL_REPORT_ASSISTANT) {
			const prefixUrl =
				envPublic.PUBLIC_SHARE_PREFIX || `${envPublic.PUBLIC_ORIGIN || url.origin}${base}`;
			const toolUrl = `${prefixUrl}/tools/${params.toolId}`;

			const tool = await collections.tools.findOne<Pick<Tool, "displayName">>(
				{ _id: new ObjectId(params.toolId) },
				{ projection: { displayName: 1 } }
			);

			const username = locals.user?.username;

			await sendSlack(
				`🔴 Tool <${toolUrl}|${tool?.displayName}> reported by ${
					username ? `<http://hf.co/${username}|${username}>` : "non-logged in user"
				}.\n\n> ${result.data}`
			);
		}

		return { from: "report", ok: true, message: "Tool reported" };
	},
	deny: async ({ params, locals, url }) => {
		return await setReviewStatus({
			toolId: params.toolId,
			locals,
			status: ReviewStatus.DENIED,
			url,
		});
	},
	approve: async ({ params, locals, url }) => {
		return await setReviewStatus({
			toolId: params.toolId,
			locals,
			status: ReviewStatus.APPROVED,
			url,
		});
	},
	request: async ({ params, locals, url }) => {
		return await setReviewStatus({
			toolId: params.toolId,
			locals,
			status: ReviewStatus.PENDING,
			url,
		});
	},
	unrequest: async ({ params, locals, url }) => {
		return await setReviewStatus({
			toolId: params.toolId,
			locals,
			status: ReviewStatus.PRIVATE,
			url,
		});
	},
};

async function setReviewStatus({
	locals,
	toolId,
	status,
	url,
}: {
	locals: App.Locals;
	toolId?: string;
	status: ReviewStatus;
	url: URL;
}) {
	if (!toolId) {
		return fail(400, { error: true, message: "Tool ID is required" });
	}

	const tool = await collections.tools.findOne({
		_id: new ObjectId(toolId),
	});

	if (!tool) {
		return fail(404, { error: true, message: "Tool not found" });
	}

	if (
		!locals.user ||
		(!locals.user.isAdmin && tool.createdById.toString() !== locals.user._id.toString())
	) {
		return fail(403, { error: true, message: "Permission denied" });
	}

	// only admins can set the status to APPROVED or DENIED
	// if the status is already APPROVED or DENIED, only admins can change it

	if (
		(status === ReviewStatus.APPROVED ||
			status === ReviewStatus.DENIED ||
			tool.review === ReviewStatus.APPROVED ||
			tool.review === ReviewStatus.DENIED) &&
		!locals.user?.isAdmin
	) {
		return fail(403, { error: true, message: "Permission denied" });
	}

	const result = await collections.tools.updateOne({ _id: tool._id }, { $set: { review: status } });

	if (result.modifiedCount === 0) {
		return fail(500, { error: true, message: "Failed to update review status" });
	}

	if (status === ReviewStatus.PENDING) {
		const prefixUrl =
			envPublic.PUBLIC_SHARE_PREFIX || `${envPublic.PUBLIC_ORIGIN || url.origin}${base}`;
		const toolUrl = `${prefixUrl}/tools/${toolId}`;

		const username = locals.user?.username;

		await sendSlack(
			`🟢 Tool <${toolUrl}|${tool?.displayName}> requested to be featured by ${
				username ? `<http://hf.co/${username}|${username}>` : "non-logged in user"
			}.`
		);
	}

	return { from: "setReviewStatus", ok: true, message: "Review status updated" };
}
