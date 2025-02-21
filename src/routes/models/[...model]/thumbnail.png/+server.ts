import ModelThumbnail from "./ModelThumbnail.svelte";
import { redirect, type RequestHandler } from "@sveltejs/kit";
import type { SvelteComponent } from "svelte";

import { Resvg } from "@resvg/resvg-js";
import satori from "satori";
import { html } from "satori-html";

import InterRegular from "$lib/server/fonts/Inter-Regular.ttf";
import InterBold from "$lib/server/fonts/Inter-Bold.ttf";
import { base } from "$app/paths";
import { models } from "$lib/server/models";

export const GET: RequestHandler = (async ({ params }) => {
	const model = models.find(({ id }) => id === params.model);

	if (!model || model.unlisted) {
		redirect(302, `${base}/`);
	}
	const renderedComponent = (ModelThumbnail as unknown as SvelteComponent).render({
		name: model.name,
		logoUrl: model.logoUrl,
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
