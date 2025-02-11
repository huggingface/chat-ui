import { parseStringToList } from "$lib/utils/parseStringToList";
import { toolFromConfigs } from "$lib/server/tools";
import { z } from "zod";
import { collections } from "$lib/server/database";
import { ObjectId } from "mongodb";
import { sha256 } from "$lib/utils/sha256";

export const asssistantSchema = z.object({
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

export const uploadAssistantAvatar = async (
	avatar: File,
	assistantId: ObjectId
): Promise<string> => {
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
