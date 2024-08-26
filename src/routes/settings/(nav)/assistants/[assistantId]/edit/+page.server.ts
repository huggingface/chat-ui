import { base } from "$app/paths";
import { requiresUser } from "$lib/server/auth";
import { collections } from "$lib/server/database";
import { fail, type Actions, redirect } from "@sveltejs/kit";
import { ObjectId } from "mongodb";

import { z } from "zod";
import { sha256 } from "$lib/utils/sha256";

import sharp from "sharp";
import { parseStringToList } from "$lib/utils/parseStringToList";
import { generateSearchTokens } from "$lib/utils/searchTokens";
import { toolFromConfigs } from "$lib/server/tools";

const newAsssistantSchema = z.object({
	name: z.string().min(1),
	modelId: z.string().min(1),
	preprompt: z.string().min(1),
	description: z.string().optional(),
	exampleInput1: z.string().optional(),
	exampleInput2: z.string().optional(),
	exampleInput3: z.string().optional(),
	exampleInput4: z.string().optional(),
	avatar: z.union([z.instanceof(File), z.literal("null")]).optional(),
	ragLinkList: z.preprocess(parseStringToList, z.string().url().array().max(10)),
	ragDomainList: z.preprocess(parseStringToList, z.string().array()),
	ragAllowAll: z.preprocess((v) => v === "true", z.boolean()),
	dynamicPrompt: z.preprocess((v) => v === "on", z.boolean()),
	temperature: z
		.union([z.literal(""), z.coerce.number().min(0.1).max(2)])
		.transform((v) => (v === "" ? undefined : v)),
	top_p: z
		.union([z.literal(""), z.coerce.number().min(0.05).max(1)])
		.transform((v) => (v === "" ? undefined : v)),

	repetition_penalty: z
		.union([z.literal(""), z.coerce.number().min(0.1).max(2)])
		.transform((v) => (v === "" ? undefined : v)),

	top_k: z
		.union([z.literal(""), z.coerce.number().min(5).max(100)])
		.transform((v) => (v === "" ? undefined : v)),
	tools: z
		.string()
		.optional()
		.transform((v) => (v ? v.split(",") : []))
		.transform(async (v) => [
			...(await collections.tools
				.find({ _id: { $in: v.map((toolId) => new ObjectId(toolId)) } })
				.project({ _id: 1 })
				.toArray()
				.then((tools) => tools.map((tool) => tool._id.toString()))),
			...toolFromConfigs
				.filter((el) => (v ?? []).includes(el._id.toString()))
				.map((el) => el._id.toString()),
		])
		.optional(),
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

export const actions: Actions = {
	default: async ({ request, locals, params }) => {
		const assistant = await collections.assistants.findOne({
			_id: new ObjectId(params.assistantId),
		});

		if (!assistant) {
			throw Error("Assistant not found");
		}

		if (assistant.createdById.toString() !== (locals.user?._id ?? locals.sessionId).toString()) {
			throw Error("You are not the author of this assistant");
		}

		const formData = Object.fromEntries(await request.formData());

		const parse = await newAsssistantSchema.safeParseAsync(formData);

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

		const exampleInputs: string[] = [
			parse?.data?.exampleInput1 ?? "",
			parse?.data?.exampleInput2 ?? "",
			parse?.data?.exampleInput3 ?? "",
			parse?.data?.exampleInput4 ?? "",
		].filter((input) => !!input);

		const deleteAvatar = parse.data.avatar === "null";

		let hash;
		if (parse.data.avatar && parse.data.avatar !== "null" && parse.data.avatar.size > 0) {
			let image;
			try {
				image = await sharp(await parse.data.avatar.arrayBuffer())
					.resize(512, 512, { fit: "inside" })
					.jpeg({ quality: 80 })
					.toBuffer();
			} catch (e) {
				const errors = [{ field: "avatar", message: (e as Error).message }];
				return fail(400, { error: true, errors });
			}

			const fileCursor = collections.bucket.find({ filename: assistant._id.toString() });

			// Step 2: Delete the existing file if it exists
			let fileId = await fileCursor.next();
			while (fileId) {
				await collections.bucket.delete(fileId._id);
				fileId = await fileCursor.next();
			}

			hash = await uploadAvatar(new File([image], "avatar.jpg"), assistant._id);
		} else if (deleteAvatar) {
			// delete the avatar
			const fileCursor = collections.bucket.find({ filename: assistant._id.toString() });

			let fileId = await fileCursor.next();
			while (fileId) {
				await collections.bucket.delete(fileId._id);
				fileId = await fileCursor.next();
			}
		}

		const { acknowledged } = await collections.assistants.updateOne(
			{
				_id: assistant._id,
			},
			{
				$set: {
					name: parse.data.name,
					description: parse.data.description,
					modelId: parse.data.modelId,
					preprompt: parse.data.preprompt,
					exampleInputs,
					avatar: deleteAvatar ? undefined : hash ?? assistant.avatar,
					updatedAt: new Date(),
					rag: {
						allowedLinks: parse.data.ragLinkList,
						allowedDomains: parse.data.ragDomainList,
						allowAllDomains: parse.data.ragAllowAll,
					},
					tools: parse.data.tools,
					dynamicPrompt: parse.data.dynamicPrompt,
					searchTokens: generateSearchTokens(parse.data.name),
					generateSettings: {
						temperature: parse.data.temperature,
						top_p: parse.data.top_p,
						repetition_penalty: parse.data.repetition_penalty,
						top_k: parse.data.top_k,
					},
				},
			}
		);

		if (acknowledged) {
			redirect(302, `${base}/settings/assistants/${assistant._id}`);
		} else {
			throw Error("Update failed");
		}
	},
};
