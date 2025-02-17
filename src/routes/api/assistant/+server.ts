import { authCondition } from "$lib/server/auth.js";
import { requiresUser } from "$lib/server/auth.js";
import { asssistantSchema } from "./utils.js";
import { uploadAssistantAvatar } from "./utils.js";
import { collections } from "$lib/server/database.js";
import { ObjectId } from "mongodb";
import sharp from "sharp";
import { generateSearchTokens } from "$lib/utils/searchTokens";
import { usageLimits } from "$lib/server/usageLimits.js";
import { ReviewStatus } from "$lib/types/Review.js";

export async function POST({ request, locals }) {
	const formData = await request.formData();
	const parse = await asssistantSchema.safeParseAsync(Object.fromEntries(formData));

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

	// can only create assistants when logged in, IF login is setup
	if (!locals.user && requiresUser) {
		const errors = [{ field: "preprompt", message: "Must be logged in. Unauthorized" }];
		return new Response(JSON.stringify({ error: true, errors }), { status: 400 });
	}

	const createdById = locals.user?._id ?? locals.sessionId;

	const assistantsCount = await collections.assistants.countDocuments({ createdById });

	if (usageLimits?.assistants && assistantsCount > usageLimits.assistants) {
		const errors = [
			{
				field: "preprompt",
				message: "You have reached the maximum number of assistants. Delete some to continue.",
			},
		];
		return new Response(JSON.stringify({ error: true, errors }), { status: 400 });
	}

	const newAssistantId = new ObjectId();

	const exampleInputs: string[] = [
		parse?.data?.exampleInput1 ?? "",
		parse?.data?.exampleInput2 ?? "",
		parse?.data?.exampleInput3 ?? "",
		parse?.data?.exampleInput4 ?? "",
	].filter((input) => !!input);

	let hash;
	if (parse.data.avatar && parse.data.avatar instanceof File && parse.data.avatar.size > 0) {
		let image;
		try {
			image = await sharp(await parse.data.avatar.arrayBuffer())
				.resize(512, 512, { fit: "inside" })
				.jpeg({ quality: 80 })
				.toBuffer();
		} catch (e) {
			const errors = [{ field: "avatar", message: (e as Error).message }];
			return new Response(JSON.stringify({ error: true, errors }), { status: 400 });
		}

		hash = await uploadAssistantAvatar(new File([image], "avatar.jpg"), newAssistantId);
	}

	const { insertedId } = await collections.assistants.insertOne({
		_id: newAssistantId,
		createdById,
		createdByName: locals.user?.username ?? locals.user?.name,
		...parse.data,
		tools: parse.data.tools,
		exampleInputs,
		avatar: hash,
		createdAt: new Date(),
		updatedAt: new Date(),
		userCount: 1,
		review: ReviewStatus.PRIVATE,
		rag: {
			allowedLinks: parse.data.ragLinkList,
			allowedDomains: parse.data.ragDomainList,
			allowAllDomains: parse.data.ragAllowAll,
		},
		dynamicPrompt: parse.data.dynamicPrompt,
		searchTokens: generateSearchTokens(parse.data.name),
		last24HoursCount: 0,
		generateSettings: {
			temperature: parse.data.temperature,
			top_p: parse.data.top_p,
			repetition_penalty: parse.data.repetition_penalty,
			top_k: parse.data.top_k,
		},
	});

	// add insertedId to user settings

	await collections.settings.updateOne(authCondition(locals), {
		$addToSet: { assistants: insertedId },
	});

	return new Response(JSON.stringify({ success: true, assistantId: insertedId }), { status: 200 });
}
