import satori from "satori";
import { Resvg } from "@resvg/resvg-js";

import InterRegular from "$lib/server/fonts/Inter-Regular.ttf";
import InterSemiBold from "$lib/server/fonts/Inter-SemiBold.ttf";
import InterBold from "$lib/server/fonts/Inter-Bold.ttf";
import logo from "../../../../../static/huggingchat/fulltext-logo.svg?raw";
// Same 1200x648 background the model thumbnails use (ModelThumbnail.svelte
// loads it from the CDN), vendored and inlined so rendering needs no network
import backgroundDataUri from "./thumbnail-background.png?inline";

// The element tree is built as plain objects instead of going through
// satori-html: user-authored prompt text must never be parsed as HTML
// (satori-html would follow attacker-controlled <img> URLs server-side and
// renders escaped entities literally). With plain objects, text is only ever
// a string child that satori converts to glyph outlines.
interface SatoriElement {
	type: string;
	props: {
		style?: Record<string, string | number>;
		children?: SatoriElement | SatoriElement[] | string;
		src?: string;
		width?: number;
		height?: number;
	};
}

function el(
	type: string,
	style: Record<string, string | number>,
	children?: SatoriElement | SatoriElement[] | string,
	props: Omit<SatoriElement["props"], "style" | "children"> = {}
): SatoriElement {
	return { type, props: { style, children, ...props } };
}

const LEFT_QUOTE = String.fromCharCode(0x201c);
const RIGHT_QUOTE = String.fromCharCode(0x201d);

// White HuggingChat logo as a data URI so no network fetch happens at render
// time. The source svg only declares height="55" against a 575x100 viewBox,
// which makes its intrinsic size ambiguous (renderers stretch it to 575x55),
// so pin the intrinsic size to the viewBox before encoding.
const LOGO_HEIGHT = 64;
const LOGO_WIDTH = Math.round((LOGO_HEIGHT * 575) / 100);
const logoDataUri = `data:image/svg+xml;base64,${Buffer.from(
	logo.replace(/<svg [^>]*?height="\d+"/, '<svg width="575" height="100"')
).toString("base64")}`;
const logoElement = el("img", { width: LOGO_WIDTH, height: LOGO_HEIGHT }, undefined, {
	src: logoDataUri,
	width: LOGO_WIDTH,
	height: LOGO_HEIGHT,
});

export interface ShareThumbnailOptions {
	/** Sanitized prompt text (see renderableThumbnailText); "" renders the generic card */
	prompt: string;
	/** Model id shown at the bottom; empty string hides it */
	modelName: string;
	isHuggingChat: boolean;
	/** Branding used when not HuggingChat */
	appName: string;
}

function shareThumbnailElement({
	prompt,
	modelName,
	isHuggingChat,
	appName,
}: ShareThumbnailOptions): SatoriElement {
	const fontSize = prompt.length <= 70 ? 64 : prompt.length <= 150 ? 56 : 48;

	const promptBlock = prompt
		? el(
				"div",
				{
					display: "block",
					lineClamp: 3,
					fontSize,
					fontWeight: 700,
					lineHeight: 1.3,
					color: "#ffffff",
					textAlign: "center",
					wordBreak: "break-word",
				},
				LEFT_QUOTE + prompt + RIGHT_QUOTE
			)
		: el(
				"div",
				{
					display: "block",
					fontSize: 64,
					fontWeight: 700,
					lineHeight: 1.3,
					color: "#ffffff",
					textAlign: "center",
				},
				"A conversation shared with you"
			);

	// Same construction as the model thumbnails: "Chat with it on <logo>"
	const brandingRow = el(
		"div",
		{ display: "flex", alignItems: "center", marginTop: 56 },
		isHuggingChat
			? [
					el("div", { fontSize: 36, color: "#ffffff", marginRight: 16 }, "Continue the chat on"),
					logoElement,
				]
			: [
					el("div", { fontSize: 36, color: "#ffffff", marginRight: 16 }, "Continue the chat on"),
					el("div", { fontSize: 44, fontWeight: 700, color: "#ffffff" }, appName),
				]
	);

	return el(
		"div",
		{
			display: "flex",
			flexDirection: "column",
			alignItems: "center",
			justifyContent: "center",
			width: "100%",
			height: "100%",
			padding: "64px 96px",
			backgroundColor: "#000000",
			backgroundImage: `url(${backgroundDataUri})`,
		},
		[
			el("div", { display: "flex", width: "100%", justifyContent: "center" }, promptBlock),
			brandingRow,
			// Translucent pill keeps the model id legible over the light streak
			modelName
				? el(
						"div",
						{
							fontSize: 26,
							color: "#d1d5db",
							marginTop: 48,
							backgroundColor: "rgba(0, 0, 0, 0.6)",
							borderRadius: 999,
							padding: "10px 28px",
						},
						modelName
					)
				: el("div", {}),
		]
	);
}

export const SHARE_THUMBNAIL_WIDTH = 1200;
export const SHARE_THUMBNAIL_HEIGHT = 648;

export async function renderShareThumbnailPng(options: ShareThumbnailOptions): Promise<Uint8Array> {
	const element = shareThumbnailElement(options);

	// satori's TS types expect a ReactNode; the plain-object VNode shape above is
	// what it consumes at runtime (same cast as the model thumbnail endpoint).
	const svg = await satori(element as unknown as never, {
		width: SHARE_THUMBNAIL_WIDTH,
		height: SHARE_THUMBNAIL_HEIGHT,
		fonts: [
			{ name: "Inter", data: InterRegular as unknown as ArrayBuffer, weight: 400 },
			{ name: "Inter", data: InterSemiBold as unknown as ArrayBuffer, weight: 600 },
			{ name: "Inter", data: InterBold as unknown as ArrayBuffer, weight: 700 },
		],
	});

	const png = new Resvg(svg, { fitTo: { mode: "original" } }).render().asPng();

	return new Uint8Array(png);
}
