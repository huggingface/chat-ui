import { base } from "$app/paths";
import { collections } from "$lib/server/database.js";
import { toolFromConfigs } from "$lib/server/tools/index.js";
import { ReviewStatus } from "$lib/types/Review.js";
import { redirect } from "@sveltejs/kit";
import { ObjectId } from "mongodb";

export const load = async ({ params, locals }) => {
	const tool = await collections.tools.findOne({ _id: new ObjectId(params.toolId) });

	if (!tool) {
		const tool = toolFromConfigs.find((el) => el._id.toString() === params.toolId);
		if (!tool) {
			redirect(302, `${base}/tools`);
		}
		return {
			tool: {
				...tool,
				_id: tool._id.toString(),
				call: undefined,
				createdById: null,
				createdByName: null,
				createdByMe: false,
				reported: false,
				review: ReviewStatus.APPROVED,
			},
		};
	}

	const reported = await collections.reports.findOne({
		contentId: tool._id,
		object: "tool",
	});

	return {
		tool: {
			...tool,
			_id: tool._id.toString(),
			call: undefined,
			createdById: tool.createdById.toString(),
			createdByMe:
				tool.createdById.toString() === (locals.user?._id ?? locals.sessionId).toString(),
			reported: !!reported,
		},
	};
};
