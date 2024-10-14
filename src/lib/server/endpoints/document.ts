import type { MessageFile } from "$lib/types/Message";
import { z, type util } from "zod";

export interface FileProcessorOptions<TMimeType extends string = string> {
	supportedMimeTypes: TMimeType[];
	preferredMimeType: TMimeType;
	maxSizeInMB: number;
}

export type ImageProcessor<TMimeType extends string = string> = (file: MessageFile) => Promise<{
	file: Buffer;
	mime: TMimeType;
}>;

export const createDocumentProcessorOptionsValidator = <TMimeType extends string = string>(
	defaults: FileProcessorOptions<TMimeType>
) => {
	return z
		.object({
			supportedMimeTypes: z
				.array(
					z.enum<string, [TMimeType, ...TMimeType[]]>([
						defaults.supportedMimeTypes[0],
						...defaults.supportedMimeTypes.slice(1),
					])
				)
				.default(defaults.supportedMimeTypes),
			preferredMimeType: z
				.enum([defaults.supportedMimeTypes[0], ...defaults.supportedMimeTypes.slice(1)])
				.default(defaults.preferredMimeType as util.noUndefined<TMimeType>),
			maxSizeInMB: z.number().positive().default(defaults.maxSizeInMB),
		})
		.default(defaults);
};

export type DocumentProcessor<TMimeType extends string = string> = (file: MessageFile) => {
	file: Buffer;
	mime: TMimeType;
};

export function makeDocumentProcessor<TMimeType extends string = string>(
	options: FileProcessorOptions<TMimeType>
): DocumentProcessor<TMimeType> {
	return (file) => {
		const { supportedMimeTypes, preferredMimeType, maxSizeInMB } = options;
		const { mime, value } = file;

		const buffer = Buffer.from(value, "base64");

		const tooLargeInBytes = buffer.byteLength > maxSizeInMB * 1000 * 1000;

		if (tooLargeInBytes) {
			throw Error("Document is too large");
		}

		const outputMime = validateMimeType(supportedMimeTypes, preferredMimeType, mime);

		return { file: buffer, mime: outputMime };
	};
}

const validateMimeType = <T extends readonly string[]>(
	supportedMimes: T,
	preferredMime: string,
	mime: string
): T[number] => {
	if (!supportedMimes.includes(preferredMime)) {
		const supportedMimesStr = supportedMimes.join(", ");
		throw Error(
			`Preferred format "${preferredMime}" not found in supported mimes: ${supportedMimesStr}`
		);
	}

	return mime;
};
