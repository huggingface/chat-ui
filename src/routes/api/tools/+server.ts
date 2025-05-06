import { config } from "$lib/server/config";
import { authCondition, requiresUser } from "$lib/server/auth.js";
import { collections } from "$lib/server/database.js";
import { editableToolSchema } from "$lib/server/tools/index.js";
import { generateSearchTokens } from "$lib/utils/searchTokens.js";
import { ObjectId } from "mongodb";
import { ReviewStatus } from "$lib/types/Review.js";
import { error } from "@sveltejs/kit";
import { usageLimits } from "$lib/server/usageLimits.js";

export async function POST({ request, locals }) {
	if (config.COMMUNITY_TOOLS !== "true") {
		error(403, "Community tools are not enabled");
	}
	const body = await request.json();

	const parse = editableToolSchema.safeParse(body);

	if (!parse.success) {
		// Loop through the errors array and create a custom errors array
		const errors = parse.error.errors.map((error) => {
			return {
				field: error.path[0],
				message: error.message,
			};
		});

		return new Response(JSON.stringify({ error: true, errors }), { status: 400 });
	}

	// can only create tools when logged in, IF login is setup
	if (!locals.user && requiresUser) {
		const errors = [{ field: "description", message: "Must be logged in. Unauthorized" }];
		return new Response(JSON.stringify({ error: true, errors }), { status: 400 });
	}

	const toolCounts = await collections.tools.countDocuments({ createdById: locals.user?._id });

	if (usageLimits?.tools && toolCounts > usageLimits.tools) {
		const errors = [
			{
				field: "description",
				message: "You have reached the maximum number of tools. Delete some to continue.",
			},
		];
		return new Response(JSON.stringify({ error: true, errors }), { status: 400 });
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
		review: ReviewStatus.PRIVATE,
		searchTokens: generateSearchTokens(parse.data.displayName),
	});

	return new Response(JSON.stringify({ toolId: insertedId.toString() }), { status: 200 });
}
