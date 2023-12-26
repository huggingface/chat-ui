import { base } from "$app/paths";
import { authCondition, requiresUser } from "$lib/server/auth";
import { collections } from "$lib/server/database";
import { fail, type Actions, redirect } from "@sveltejs/kit";
import { ObjectId } from "mongodb";

import { z } from "zod";
import sizeof from "image-size";
import { sha256 } from "$lib/utils/sha256";
import { HfInference } from "@huggingface/inference";
import { ASSISTANTS_GENERATE_AVATAR, HF_TOKEN, TEXT_TO_IMAGE_MODEL } from "$env/static/private";
import { generateFromDefaultEndpoint } from "$lib/server/generateFromDefaultEndpoint";

const newAsssistantSchema = z.object({
	name: z.string().min(1),
	modelId: z.string().min(1),
	preprompt: z.string().min(1),
	description: z.string().optional(),
	exampleInput1: z.string().optional(),
	exampleInput2: z.string().optional(),
	exampleInput3: z.string().optional(),
	exampleInput4: z.string().optional(),
	avatar: z.instanceof(File).optional(),
});

const uploadAvatar = async (avatar: File, assistantId: ObjectId): Promise<string> => {
	const hash = await sha256(await avatar.text());
	const upload = collections.bucket.openUploadStream(`${assistantId.toString()}`, {
		metadata: { type: avatar.type, hash },
	});

	upload.write((await avatar.arrayBuffer()) as unknown as Buffer);
	upload.end();

	// only return the filename when upload throws a finish event or a 10s time out occurs
	return new Promise((resolve, reject) => {
		upload.once("finish", () => resolve(hash));
		upload.once("error", reject);
		setTimeout(() => reject(new Error("Upload timed out")), 10000);
	});
};

const generateAvatar = (description?: string, name?: string): Promise<string> => {
	const textPrompt = `Generate a prompt for an image-generation model for the following: 
Name: ${name}
Description: ${description}
`;

	return generateFromDefaultEndpoint({
		messages: [{ from: "user", content: textPrompt }],
		preprompt:
			"You are an assistant tasked with generating simple image descriptions. The user will ask you for an image, baed on the name and a description of what they want, and you should reply with a short, concise, safe, descriptive sentence.",
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
			const errors = [{ field: "preprompt", message: "Must be logged in. Unauthorized" }];
			return fail(400, { error: true, errors });
		}

		const createdById = locals.user?._id ?? locals.sessionId;

		const newAssistantId = new ObjectId();

		const exampleInputs: string[] = [
			parse?.data?.exampleInput1 ?? "",
			parse?.data?.exampleInput2 ?? "",
			parse?.data?.exampleInput3 ?? "",
			parse?.data?.exampleInput4 ?? "",
		].filter((input) => !!input);

		let hash;
		if (parse.data.avatar && parse.data.avatar.size > 0) {
			const dims = sizeof(Buffer.from(await parse.data.avatar.arrayBuffer()));

			if ((dims.height ?? 1000) > 512 || (dims.width ?? 1000) > 512) {
				const errors = [{ field: "avatar", message: "Avatar too big" }];
				return fail(400, { error: true, errors });
			}

			hash = await uploadAvatar(parse.data.avatar, newAssistantId);
		} else if (ASSISTANTS_GENERATE_AVATAR === "true" && HF_TOKEN !== "") {
			const hf = new HfInference(HF_TOKEN);

			const blob = await hf.textToImage({
				inputs: await generateAvatar(parse.data.description, parse.data.name),
				model: TEXT_TO_IMAGE_MODEL,
			});

			hash = await uploadAvatar(new File([blob], "avatar.png"), newAssistantId);
		}

		const { insertedId } = await collections.assistants.insertOne({
			_id: newAssistantId,
			createdById,
			createdByName: locals.user?.username,
			...parse.data,
			exampleInputs,
			avatar: hash,
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
