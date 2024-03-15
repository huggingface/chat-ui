import { collections } from "$lib/server/database";
import type { LayoutServerLoad } from "./$types";
import type { Report } from "$lib/types/Report";

export const load = (async ({ locals, parent }) => {
	const { assistants } = await parent();

	let reportsByUser: string[] = [];
	const createdBy = locals.user?._id ?? locals.sessionId;
	if (createdBy) {
		const reports = await collections.reports
			.find<Pick<Report, "assistantId">>({ createdBy }, { projection: { _id: 0, assistantId: 1 } })
			.toArray();
		reportsByUser = reports.map((r) => r.assistantId.toString());
	}

	return {
		assistants: assistants.map((el) => ({
			...el,
			reported: reportsByUser.includes(el._id),
		})),
	};
}) satisfies LayoutServerLoad;
