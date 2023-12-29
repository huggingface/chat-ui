import { APP_BASE } from "$env/static/private";
import ChatThumbnail from "./ChatThumbnail.svelte";
import { collections } from "$lib/server/database";
import { error, type RequestHandler } from "@sveltejs/kit";
import { ObjectId } from "mongodb";
import { image_from_component as imageFromComponent } from "svelte-component-to-image";

export const GET: RequestHandler = (async ({ url, params }) => {
	const assistant = await collections.assistants.findOne({
		_id: new ObjectId(params.assistantId),
	});

	if (!assistant) {
		throw error(404, "Assistant not found.");
	}

	try {
		const response = new Response(
			await imageFromComponent(ChatThumbnail, {
				width: 700,
				height: 370,
				props: {
					name: assistant.name,
					description: assistant.description,
					avatarUrl: assistant.avatar
						? url.origin + APP_BASE + "/settings/assistants/" + assistant._id + "/avatar"
						: undefined,
				},
				fonts: [
					{
						name: "Inter",
						url: "https://cdn.jsdelivr.net/npm/inter-font@3.19.0/ttf/Inter-Medium.ttf",
						weight: 500,
					},
				],
			})
		);
		response.headers.append("Content-Type", "image/png");
		// response.headers.append("Cache-Control", "s-maxage=604800, stale-while-revalidate=604800");
		return response;
	} catch (e) {
		throw error(500, "Error trying to generate image from component.");
	}
}) satisfies RequestHandler;
