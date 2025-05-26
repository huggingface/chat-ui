import { collections } from "$lib/server/database";
import { error } from "@sveltejs/kit";
import { ObjectId } from "mongodb";
import { asssistantSchema, uploadAssistantAvatar } from "../utils.js";
import { requiresUser } from "$lib/server/auth.js";
import sharp from "sharp";
import { generateSearchTokens } from "$lib/utils/searchTokens";

export async function GET({ params }) {
	const id = params.id;
	const assistantId = new ObjectId(id);

	const assistant = await collections.assistants.findOne({
		_id: assistantId,
	});

	if (assistant) {
		return Response.json(assistant);
	} else {
		return Response.json({ message: "Assistant not found" }, { status: 404 });
	}
}

export async function PATCH({ request, locals, params }) {
	const assistant = await collections.assistants.findOne({
		_id: new ObjectId(params.id),
	});

	if (!assistant) {
		throw Error("Assistant not found");
	}

	if (assistant.createdById.toString() !== (locals.user?._id ?? locals.sessionId).toString()) {
		throw Error("You are not the author of this assistant");
	}

	const formData = Object.fromEntries(await request.formData());

	const parse = await asssistantSchema.safeParseAsync(formData);

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
			return new Response(JSON.stringify({ error: true, errors }), { status: 400 });
		}

		const fileCursor = collections.bucket.find({ filename: assistant._id.toString() });

		// Step 2: Delete the existing file if it exists
		let fileId = await fileCursor.next();
		while (fileId) {
			await collections.bucket.delete(fileId._id);
			fileId = await fileCursor.next();
		}

		hash = await uploadAssistantAvatar(new File([image], "avatar.jpg"), assistant._id);
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
				avatar: deleteAvatar ? undefined : (hash ?? assistant.avatar),
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
		return new Response(JSON.stringify({ success: true, assistantId: assistant._id }), {
			status: 200,
		});
	} else {
		return new Response(JSON.stringify({ error: true, message: "Update failed" }), { status: 500 });
	}
}

export async function DELETE({ params, locals }) {
	const assistant = await collections.assistants.findOne({ _id: new ObjectId(params.id) });

	if (!assistant) {
		return error(404, "Assistant not found");
	}

	if (
		assistant.createdById.toString() !== (locals.user?._id ?? locals.sessionId).toString() &&
		!locals.isAdmin
	) {
		return error(403, "You are not the author of this assistant");
	}

	await collections.assistants.deleteOne({ _id: assistant._id });

	// and remove it from all users settings
	await collections.settings.updateMany(
		{
			assistants: { $in: [assistant._id] },
		},
		{
			$pull: { assistants: assistant._id },
		}
	);

	// and delete all avatars
	const fileCursor = collections.bucket.find({ filename: assistant._id.toString() });

	// Step 2: Delete the existing file if it exists
	let fileId = await fileCursor.next();
	while (fileId) {
		await collections.bucket.delete(fileId._id);
		fileId = await fileCursor.next();
	}

	return new Response("Assistant deleted", { status: 200 });
}
