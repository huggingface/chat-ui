import { HF_ACCESS_TOKEN, HF_TOKEN } from "$env/static/private";
import { buildPrompt } from "$lib/buildPrompt";
import { textGenerationStream } from "@huggingface/inference";
import type { Endpoint, EndpointMessage } from "../endpoints";
import { z } from "zod";
import sharp from "sharp";
import type { MessageFile } from "$lib/types/Message";
import { chooseMimeType, convertImage } from "../images";

export const endpointTgiParametersSchema = z.object({
	weight: z.number().int().positive().default(1),
	model: z.any(),
	type: z.literal("tgi"),
	url: z.string().url(),
	accessToken: z.string().default(HF_TOKEN ?? HF_ACCESS_TOKEN),
	authorization: z.string().optional(),
});

export function endpointTgi(input: z.input<typeof endpointTgiParametersSchema>): Endpoint {
	const { url, accessToken, model, authorization } = endpointTgiParametersSchema.parse(input);

	return async ({ messages, preprompt, continueMessage, generateSettings }) => {
		// currently, only IDEFICS is supported by TGI
		// the size of images is hardcoded to 224x224 in TGI
		const messagesWithResizedFiles = await Promise.all(messages.map(resizeFiles));

		const prompt = await buildPrompt({
			messages: messagesWithResizedFiles,
			preprompt,
			model,
			continueMessage,
		});

		return textGenerationStream(
			{
				parameters: { ...model.parameters, ...generateSettings, return_full_text: false },
				model: url,
				inputs: prompt,
				accessToken,
			},
			{
				use_cache: false,
				fetch: async (endpointUrl, info) => {
					if (info && authorization && !accessToken) {
						// Set authorization header if it is defined and HF_TOKEN is empty
						info.headers = {
							...info.headers,
							Authorization: authorization,
						};
					}
					return fetch(endpointUrl, info);
				},
			}
		);
	};
}

const whiteImageBase64 =
	"/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/2wBDAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAARCAAQABADAREAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD+/igAoAKACgD/2Q==";

async function resizeFiles(message: EndpointMessage): Promise<EndpointMessage> {
	const files = message.files ?? [{ type: "base64", value: whiteImageBase64, mime: "image/png" }];

	const resizedFiles = await Promise.all(files.map(resizeFile));

	const markdowns = resizedFiles.map((file) => `![](data:${file.mime};base64,${file.value})`);
	const content = message.content + "\n" + markdowns.join("\n ");

	return { ...message, content };
}

const supportedMimeTypes = ["image/png", "image/jpeg", "image/webp"] as const;
async function resizeFile(file: MessageFile): Promise<MessageFile> {
	const buffer = Buffer.from(file.value, "base64");
	// TGI requires 224x224 images
	let image = sharp(buffer).resize({ fit: "inside", width: 224, height: 224 });

	// Convert format if necessary
	const mime = chooseMimeType(supportedMimeTypes, "webp", file.mime);
	if (mime !== file.mime) image = convertImage(image, mime);

	const imageBase64 = await image.toBuffer().then((buf) => buf.toString("base64"));
	return { ...file, mime, value: imageBase64 };
}
