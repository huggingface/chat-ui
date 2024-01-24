import { APP_BASE } from "$env/static/private";
import ChatThumbnail from "./ChatThumbnail.svelte";
import { collections } from "$lib/server/database";
import { error, type RequestHandler } from "@sveltejs/kit";
import { ObjectId } from "mongodb";
import type { SvelteComponent } from "svelte";

import { Resvg } from "@resvg/resvg-js";
import satori from "satori";
import { html } from "satori-html";

import InterRegular from "../../../../../static/fonts/Inter-Regular.ttf";
import InterBold from "../../../../../static/fonts/Inter-Bold.ttf";

export const GET: RequestHandler = (async ({ url, params }) => {
	const assistant = await collections.assistants.findOne({
		_id: new ObjectId(params.assistantId),
	});

	if (!assistant) {
		throw error(404, "Assistant not found.");
	}

	const renderedComponent = (ChatThumbnail as unknown as SvelteComponent).render({
		href: url.origin,
		name: assistant.name,
		description: assistant.description,
		createdByName: assistant.createdByName,
		avatarUrl: assistant.avatar
			? url.origin + APP_BASE + "/settings/assistants/" + assistant._id + "/avatar"
			: undefined,
	});

	const reactLike = html(
		"<style>" + renderedComponent.css.code + "</style>" + renderedComponent.html
	);

	const svg = await satori(reactLike, {
		width: 1200,
		height: 648,
		fonts: [
			{
				name: "Inter",
				data: InterRegular as unknown as ArrayBuffer,
				weight: 500,
			},
			{
				name: "Inter",
				data: InterBold as unknown as ArrayBuffer,
				weight: 700,
			},
		],
	});

	const png = new Resvg(svg, {
		fitTo: { mode: "original" },
	})
		.render()
		.asPng();

	return new Response(png, {
		headers: {
			"Content-Type": "image/png",
		},
	});
}) satisfies RequestHandler;
