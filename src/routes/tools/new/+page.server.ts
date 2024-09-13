import { env } from "$env/dynamic/private";
import { authCondition, requiresUser } from "$lib/server/auth.js";
import { collections } from "$lib/server/database.js";
import { editableToolSchema } from "$lib/server/tools/index.js";
import { usageLimits } from "$lib/server/usageLimits.js";
import { generateSearchTokens } from "$lib/utils/searchTokens.js";
import { error, fail } from "@sveltejs/kit";
import { ObjectId } from "mongodb";

export const actions = {
	default: async ({ request, locals }) => {
		if (env.COMMUNITY_TOOLS !== "true") {
			error(403, "Community tools are not enabled");
		}

		const body = await request.formData();
		const toolStringified = body.get("tool");

		if (!toolStringified || typeof toolStringified !== "string") {
			error(400, "Tool is required");
		}

		const parse = editableToolSchema.safeParse(JSON.parse(toolStringified));

		if (!parse.success) {
			// Loop through the errors array and create a custom errors array
			const errors = parse.error.errors.map((error) => {
				return {
					field: error.path[0],
					message: error.message,
				};
			});

			return fail(400, { error: true, errors });
		}

		// can only create tools when logged in, IF login is setup
		if (!locals.user && requiresUser) {
			const errors = [{ field: "description", message: "Must be logged in. Unauthorized" }];
			return fail(400, { error: true, errors });
		}

		const toolCounts = await collections.tools.countDocuments({ createdById: locals.user?._id });

		if (usageLimits?.tools && toolCounts > usageLimits.tools) {
			const errors = [
				{
					field: "description",
					message: "You have reached the maximum number of tools. Delete some to continue.",
				},
			];
			return fail(400, { error: true, errors });
		}

		if (!locals.user || !authCondition(locals)) {
			error(401, "Unauthorized");
		}

		const { insertedId } = await collections.tools.insertOne({
			...parse.data,
			type: "community" as const,
			_id: new ObjectId(),
			createdById: locals.user?._id,
			createdByName: locals.user?.username,
			createdAt: new Date(),
			updatedAt: new Date(),
			last24HoursUseCount: 0,
			useCount: 0,
			featured: locals.user?.isAdmin ?? false, // admin tools are featured by default
			searchTokens: generateSearchTokens(parse.data.displayName),
		});

		return { toolId: insertedId.toString() };
	},
};
