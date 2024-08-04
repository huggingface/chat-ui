import type { BackendTool } from "..";
import { uploadFile } from "../../files/uploadFile";
import { MessageUpdateType } from "$lib/types/MessageUpdate";
import { callSpace, getIpToken, type GradioImage } from "../utils";

type ImageGenerationInput = [string, string, number, boolean, number, number, number, number];
type ImageGenerationOutput = [GradioImage, unknown];

const imageGeneration: BackendTool = {
	name: "image_generation",
	displayName: "Image Generation",
	description: "Use this tool to generate an image from a prompt.",
	parameterDefinitions: {
		prompt: {
			description:
				"A prompt to generate an image from. Describe the image visually in simple terms, separate terms with a comma.",
			type: "string",
			required: true,
		},
		negativePrompt: {
			description:
				"A prompt for things that should not be in the image. Simple terms, separate terms with a comma.",
			type: "string",
			required: false,
			default: "",
		},
		width: {
			description: "Width of the generated image.",
			type: "number",
			required: false,
			default: 1024,
		},
		height: {
			description: "Height of the generated image.",
			type: "number",
			required: false,
			default: 1024,
		},
	},
	async *call({ prompt, negativePrompt, width, height }, { conv, ip, username }) {
		const ipToken = await getIpToken(ip, username);

		const outputs = await callSpace<ImageGenerationInput, ImageGenerationOutput>(
			"stabilityai/stable-diffusion-3-medium",
			"/infer",
			[
				String(prompt), // prompt
				String(negativePrompt), // negative prompt
				Math.floor(Math.random() * 1000), // seed random
				true, // randomize seed
				Number(width), // number in 'Image Width' Number component
				Number(height), // number in 'Image Height' Number component
				5, // guidance scale
				28, // steps
			],
			ipToken
		);
		const image = await fetch(outputs[0].url)
			.then((res) => res.blob())
			.then(
				(blob) =>
					new File([blob], `${prompt}.${blob.type.split("/")[1] ?? "png"}`, { type: blob.type })
			)
			.then((file) => uploadFile(file, conv));

		yield {
			type: MessageUpdateType.File,
			name: image.name,
			sha: image.value,
			mime: image.mime,
		};

		return {
			outputs: [
				{
					imageGeneration: `An image has been generated for the following prompt: "${prompt}". Answer as if the user can already see the image. Do not try to insert the image or to add space for it. The user can already see the image. Do not try to describe the image as you the model cannot see it. Be concise.`,
				},
			],
			display: false,
		};
	},
};

export default imageGeneration;
