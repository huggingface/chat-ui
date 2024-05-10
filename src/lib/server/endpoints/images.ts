import type { Sharp } from "sharp";

type OutputFormat = "png" | "jpeg" | "webp" | "avif" | "tiff" | "gif";
const outputFormats: OutputFormat[] = ["png", "jpeg", "webp", "avif", "tiff", "gif"];
const isOutputFormat = (format: string): format is (typeof outputFormats)[number] =>
	outputFormats.includes(format as OutputFormat);

export function convertImage(sharpInst: Sharp, outputMime: string): Sharp {
	const [type, format] = outputMime.split("/");
	if (type !== "image") throw Error(`Requested non-image mime type: ${outputMime}`);
	if (!isOutputFormat(format)) {
		throw Error(`Requested to convert to an unsupported format: ${format}`);
	}

	return sharpInst[format]();
}

// heic/heif requires proprietary license
// TODO: blocking heif may be incorrect considering it also supports av1, so we should instead
// detect the compression method used via sharp().metadata().compression
// TODO: consider what to do about animated formats: apng, gif, animated webp, ...
const blocklistedMimes = ["image/heic", "image/heif"];

/** Defaults to preferred format or uses existing mime if supported */
export function chooseMimeType<T extends readonly string[]>(
	supportedMimes: T,
	preferredFormat: OutputFormat,
	mime: string
): T[number] {
	if (!supportedMimes.includes(`image/${preferredFormat}`)) {
		const supportedMimesStr = supportedMimes.join(", ");
		throw Error(
			`Preferred format "${preferredFormat}" not found in supported mimes: ${supportedMimesStr}`
		);
	}

	const [type] = mime.split("/");
	if (type !== "image") throw Error(`Received non-image mime type: ${mime}`);

	if (supportedMimes.includes(mime)) return mime;

	if (blocklistedMimes.includes(mime)) throw Error(`Received blocklisted mime type: ${mime}`);

	return `image/${preferredFormat}`;
}
