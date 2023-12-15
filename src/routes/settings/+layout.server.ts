import { collections } from "$lib/server/database";
import { ObjectId } from "mongodb";
import type { LayoutServerLoad } from "./$types";

export const load = (async ({ locals, parent }) => {
	const { settings } = await parent();

	// find assistants matching the settings assistants
	const assistants = await collections.assistants
		.find({
			_id: { $in: settings.assistants.map((el) => new ObjectId(el)) },
		})
		.toArray();

	return {
		assistants: await Promise.all(
			assistants.map(async (el) => ({
				...el,
				_id: el._id.toString(),
				createdById: undefined,
				createdByMe:
					el.createdById.toString() === (locals.user?._id ?? locals.sessionId).toString(),
				reported:
					(await collections.reports.countDocuments({
						assistantId: el._id,
						createdBy: locals.user?._id ?? locals.sessionId,
					})) > 0,
			}))
		),
	};
}) satisfies LayoutServerLoad;
