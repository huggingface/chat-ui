import satori from "satori";
import { Resvg } from "@resvg/resvg-js";

import InterRegular from "$lib/server/fonts/Inter-Regular.ttf";
import InterSemiBold from "$lib/server/fonts/Inter-SemiBold.ttf";
import InterBold from "$lib/server/fonts/Inter-Bold.ttf";
import logo from "../../../../../static/huggingchat/fulltext-logo.svg?raw";

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

// White HuggingChat logo as a data URI so no network fetch happens at render time
const logoDataUri = `data:image/svg+xml;base64,${Buffer.from(logo).toString("base64")}`;

export interface ShareThumbnailOptions {
	/** Sanitized prompt text (see renderableThumbnailText); "" renders the generic card */
	prompt: string;
	/** Model id shown in the footer; empty string hides it */
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
					wordBreak: "break-word",
				},
				LEFT_QUOTE + prompt + RIGHT_QUOTE
			)
		: el(
				"div",
				{ display: "block", fontSize: 64, fontWeight: 700, lineHeight: 1.3, color: "#ffffff" },
				"A conversation shared with you"
			);

	const branding = isHuggingChat
		? el("img", { height: 48 }, undefined, { src: logoDataUri, width: 276, height: 48 })
		: el("div", { fontSize: 40, fontWeight: 700, color: "#ffffff" }, appName);

	return el(
		"div",
		{
			display: "flex",
			flexDirection: "column",
			justifyContent: "space-between",
			width: "100%",
			height: "100%",
			padding: "64px 80px",
			backgroundImage: "linear-gradient(125deg, #0f1117 0%, #161a26 55%, #2c2410 130%)",
		},
		[
			el(
				"div",
				{
					fontSize: 26,
					fontWeight: 600,
					letterSpacing: 4,
					textTransform: "uppercase",
					color: "#ffd21e",
				},
				"Shared conversation"
			),
			el(
				"div",
				{ display: "flex", flexGrow: 1, alignItems: "center", padding: "32px 0" },
				promptBlock
			),
			el(
				"div",
				{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" },
				[
					branding,
					modelName
						? el("div", { fontSize: 26, fontWeight: 400, color: "#8b929f" }, modelName)
						: el("div", {}),
				]
			),
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
