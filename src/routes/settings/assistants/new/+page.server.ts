import { base } from "$app/paths";
import { authCondition, requiresUser } from "$lib/server/auth";
import { collections } from "$lib/server/database";
import { fail, type Actions, redirect } from "@sveltejs/kit";
import { ObjectId } from "mongodb";

import { z } from "zod";
import sizeof from "image-size";

const newAsssistantSchema = z.object({
	name: z.string().min(1),
	modelId: z.string().min(1),
	preprompt: z.string().min(1),
	description: z.string().optional(),
	exampleInputs: z.string().optional(),
	avatar: z.instanceof(File).optional(),
});

const uploadAvatar = async (avatar: File, assistantId: ObjectId): Promise<string> => {
	const upload = collections.bucket.openUploadStream(`${assistantId.toString()}`, {
		metadata: { type: avatar.type },
	});

	upload.write((await avatar.arrayBuffer()) as unknown as Buffer);
	upload.end();

	// only return the filename when upload throws a finish event or a 10s time out occurs
	return new Promise((resolve, reject) => {
		upload.once("finish", () => resolve(assistantId.toString()));
		upload.once("error", reject);
		setTimeout(() => reject(new Error("Upload timed out")), 10000);
	});
};

export const actions: Actions = {
	default: async ({ request, locals }) => {
		const formData = Object.fromEntries(await request.formData());

		const parse = newAsssistantSchema.safeParse(formData);

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

		// can only create assistants when logged in, IF login is setup
		if (!locals.user && requiresUser) {
			return fail(401, { error: true, message: "Unauthorized" });
		}

		const createdById = locals.user?._id ?? locals.sessionId;

		const newAssistantId = new ObjectId();

		if (parse.data.avatar && parse.data.avatar.size > 0) {
			const dims = sizeof(Buffer.from(await parse.data.avatar.arrayBuffer()));

			if ((dims.height ?? 1000) > 512 || (dims.width ?? 1000) > 512) {
				return fail(400, { error: true, message: "Avatar too big" });
			}

			await uploadAvatar(parse.data.avatar, newAssistantId);
		}

		const { insertedId } = await collections.assistants.insertOne({
			_id: newAssistantId,
			createdById,
			createdByName: locals.user?.username,
			...parse.data,
			avatar: (parse?.data?.avatar?.size ?? 0) > 0,
			exampleInputs: [parse.data.exampleInputs ?? ""],
			createdAt: new Date(),
			updatedAt: new Date(),
		});

		// add insertedId to user settings

		await collections.settings.updateOne(authCondition(locals), {
			$push: { assistants: insertedId },
		});

		throw redirect(302, `${base}/settings/assistants/${insertedId}`);
	},
};
