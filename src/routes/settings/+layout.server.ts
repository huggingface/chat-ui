import { collections } from "$lib/server/database";
import { ObjectId } from "mongodb";
import type { LayoutServerLoad } from "./$types";
import type { Report } from "$lib/types/Report";

export const load = (async ({ locals, parent }) => {
	const { settings } = await parent();

	// find assistants matching the settings assistants
	const assistants = await collections.assistants
		.find({
			_id: { $in: settings.assistants.map((el) => new ObjectId(el)) },
		})
		.toArray();

	let reportsByUser: ObjectId[] = [];
	const createdBy = locals.user?._id ?? locals.sessionId;
	if (createdBy) {
		const reports = await collections.reports
			.find<Pick<Report, "assistantId">>({ createdBy }, { projection: { _id: 0, assistantId: 1 } })
			.toArray();
		reportsByUser = reports.map((r) => r.assistantId);
	}

	return {
		assistants: assistants.map((el) => ({
			...el,
			_id: el._id.toString(),
			createdById: undefined,
			createdByMe: el.createdById.toString() === (locals.user?._id ?? locals.sessionId).toString(),
			reported: reportsByUser.includes(el._id),
		})),
	};
}) satisfies LayoutServerLoad;
