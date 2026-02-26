import ConversationThumbnail from "./ConversationThumbnail.svelte";
import type { RequestHandler } from "@sveltejs/kit";

import { Resvg } from "@resvg/resvg-js";
import satori from "satori";
import { html } from "satori-html";

import InterRegular from "$lib/server/fonts/Inter-Regular.ttf";
import InterBold from "$lib/server/fonts/Inter-Bold.ttf";
import { collections } from "$lib/server/database";
import { config } from "$lib/server/config";
import { render } from "svelte/server";

export const GET: RequestHandler = async ({ params }) => {
	const shareId = params.id;

	const shared = await collections.sharedConversations.findOne(
		{ _id: shareId },
		{ projection: { title: 1, model: 1 } }
	);

	if (!shared) {
		return new Response("Not Found", { status: 404 });
	}

	const title = shared.title || "Untitled Conversation";
	const modelName = shared.model ? (shared.model.split("/").pop() ?? shared.model) : "";

	const renderedComponent = render(ConversationThumbnail, {
		props: {
			title,
			modelName,
			isHuggingChat: config.isHuggingChat,
		},
	});

	const reactLike = html(
		"<style>" + renderedComponent.head + "</style>" + renderedComponent.body
	) as unknown as never;

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

	return new Response(new Uint8Array(png), {
		headers: {
			"Content-Type": "image/png",
			"Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800",
		},
	});
};
