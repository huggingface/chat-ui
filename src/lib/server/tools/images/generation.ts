import type { BackendTool } from "..";
import { uploadFile } from "../../files/uploadFile";
import { ToolResultStatus } from "$lib/types/Tool";
import { MessageUpdateType } from "$lib/types/MessageUpdate";
import { callSpace, type GradioImage } from "../utils";

type ImageGenerationInput = [
	string /* prompt */,
	string /* negative prompt */,
	boolean /* use negative prompt */,
	number /* seed */,
	number /* number in 'Image Width' Number component */,
	number /* number in 'Image Height' Number component */,
	number /* guidance scale */,
	number /* number of inference steps */,
	boolean /* whether to randomize seed */
];
type ImageGenerationOutput = [{ image: GradioImage }[], number /* seed */];

const imageGeneration: BackendTool = {
	name: "image_generation",
	displayName: "Image Generation",
	description: "Use this tool to generate an image from a prompt.",
	isOnByDefault: true,
	parameterDefinitions: {
		prompt: {
			description:
				"A prompt to generate an image from. Describe the image visually in simple terms, separate terms with a comma.",
			type: "string",
			required: true,
		},
		negativePrompt: {
			description:
				"A negative prompt for avoiding certain types of images. Describe the image visually in simple terms, separate terms with a comma.",
			type: "string",
			required: false,
			default:
				"(deformed, distorted, disfigured:1.3), poorly drawn, bad anatomy, wrong anatomy, extra limb, missing limb, floating limbs, (mutated hands and fingers:1.4), disconnected limbs, mutation, mutated, ugly, disgusting, blurry, amputation, NSFW",
		},
		width: {
			description: "Width of the generated image.",
			type: "number",
			required: false,
			default: 512,
		},
		height: {
			description: "Height of the generated image.",
			type: "number",
			required: false,
			default: 512,
		},
		steps: {
			description:
				"Number of diffusion steps to generate the image. Minimum 1. Default 8. maximum 15.",
			type: "number",
			required: false,
			default: 8,
		},
	},
	async *call({ prompt, negativePrompt, width, height, steps }, { conv }) {
		const outputs = await callSpace<ImageGenerationInput, ImageGenerationOutput>(
			"KingNish/SDXL-Flash",
			"/run",
			[
				String(prompt), // prompt
				String(negativePrompt), // negative prompt
				true, // use negative prompt
				0, // seed, unused because randomized
				Number(width), // number in 'Image Width' Number component
				Number(height), // number in 'Image Height' Number component
				3, // guidance scale
				Number(steps), // number of inference steps
				true, // whether to randomize seed
			]
		);

		const imageBlobs = await Promise.all(
			outputs[0].map((output) =>
				fetch(output.image.url)
					.then((res) => res.blob())
					.then(
						(blob) =>
							new File([blob], `${prompt}.${blob.type.split("/")[1] ?? "png"}`, { type: blob.type })
					)
					.then((file) => uploadFile(file, conv))
			)
		);

		for (const image of imageBlobs) {
			yield {
				type: MessageUpdateType.File,
				name: image.name,
				sha: image.value,
				mime: image.mime,
			};
		}

		return {
			status: ToolResultStatus.Success,
			outputs: [
				{
					imageGeneration: `An image has been generated for the following prompt: "${prompt}". Answer as if the user can already see the image. Do not try to insert the image or to add space for it. The user can already see the image. Do not try to describe the image as you the model cannot see it.`,
				},
			],
			display: false,
		};
	},
};

export default imageGeneration;
