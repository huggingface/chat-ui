import { base } from "$app/paths";
import { requiresUser } from "$lib/server/auth.js";
import { collections } from "$lib/server/database.js";
import { editableToolSchema } from "$lib/server/tools/index.js";
import { generateSearchTokens } from "$lib/utils/searchTokens.js";
import { error, fail, redirect } from "@sveltejs/kit";
import { ObjectId } from "mongodb";

export const actions = {
	default: async ({ request, params, locals }) => {
		const tool = await collections.tools.findOne({
			_id: new ObjectId(params.toolId),
		});

		if (!tool) {
			throw Error("Tool not found");
		}

		if (tool.createdById.toString() !== (locals.user?._id ?? locals.sessionId).toString()) {
			throw Error("You are not the creator of this tool");
		}

		// can only create tools when logged in, IF login is setup
		if (!locals.user && requiresUser) {
			const errors = [{ field: "description", message: "Must be logged in. Unauthorized" }];
			return fail(400, { error: true, errors });
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

		// modify the tool
		await collections.tools.updateOne(
			{ _id: tool._id },
			{
				$set: {
					...parse.data,
					updatedAt: new Date(),
					searchTokens: generateSearchTokens(parse.data.displayName),
				},
			}
		);

		redirect(302, `${base}/tools/${tool._id.toString()}`);
	},
};
