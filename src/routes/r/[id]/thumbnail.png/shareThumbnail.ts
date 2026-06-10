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
const LOGO_HEIGHT = 48;
const LOGO_WIDTH = Math.round((LOGO_HEIGHT * 575) / 100);
const logoDataUri = `data:image/svg+xml;base64,${Buffer.from(
	logo.replace(/<svg [^>]*?height="\d+"/, '<svg width="575" height="100"')
).toString("base64")}`;
const logoElement = el(
	"img",
	{ width: LOGO_WIDTH, height: LOGO_HEIGHT, marginLeft: 14 },
	undefined,
	{
		src: logoDataUri,
		width: LOGO_WIDTH,
		height: LOGO_HEIGHT,
	}
);

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
	const text = prompt || "A conversation shared with you";
	const fontSize = text.length <= 45 ? 68 : text.length <= 100 ? 56 : 46;

	const promptBlock = el(
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
		text + (prompt ? RIGHT_QUOTE : "")
	);

	const continueRow = el(
		"div",
		{ display: "flex", alignItems: "center", marginTop: 34 },
		isHuggingChat
			? [el("div", { fontSize: 30, color: "#d1d5db" }, "Continue the chat on"), logoElement]
			: [
					el("div", { fontSize: 30, color: "#d1d5db" }, "Continue the chat on"),
					el("div", { fontSize: 32, fontWeight: 700, color: "#ffffff", marginLeft: 14 }, appName),
				]
	);

	const contentColumn = el(
		"div",
		{ display: "flex", flexDirection: "column", alignItems: "flex-start", maxWidth: 680 },
		[
			promptBlock,
			// Short divider line under the prompt
			el("div", {
				width: 64,
				height: 4,
				borderRadius: 2,
				backgroundColor: "rgba(255, 255, 255, 0.55)",
				marginTop: 38,
			}),
			continueRow,
			modelName
				? el(
						"div",
						{
							fontSize: 22,
							color: "#d1d5db",
							marginTop: 28,
							backgroundColor: "rgba(255, 255, 255, 0.06)",
							border: "2px solid rgba(255, 255, 255, 0.18)",
							borderRadius: 999,
							padding: "8px 24px",
						},
						modelName
					)
				: el("div", {}),
		]
	);

	return el(
		"div",
		{
			display: "flex",
			alignItems: "center",
			width: "100%",
			height: "100%",
			padding: "48px 64px",
			backgroundColor: "#000000",
			backgroundImage: `url(${backgroundDataUri})`,
		},
		el("div", { display: "flex", alignItems: "flex-start" }, [
			// Hanging opening quote, top-aligned with the first prompt line
			prompt
				? el(
						"div",
						{
							fontSize: 110,
							fontWeight: 700,
							lineHeight: 1,
							color: "#ffffff",
							marginRight: 18,
							marginTop: -14,
						},
						LEFT_QUOTE
					)
				: el("div", { width: 24 }),
			contentColumn,
		])
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
