import type { BackendTool } from "..";
import { uploadFile } from "../../files/uploadFile";
import { env } from "$env/dynamic/private";
import { Client } from "@gradio/client";
import { ToolResultStatus } from "$lib/types/Tool";
import { MessageUpdateType } from "$lib/types/MessageUpdate";

const text2img: BackendTool = {
	name: "text2img",
	displayName: "Text-to-Image",
	description: "Use this tool to generate an image from a prompt.",
	isOnByDefault: true,
	parameter_definitions: {
		prompt: {
			description:
				"A prompt to generate an image from. Describe the image visually in simple terms, separate terms with a comma.",
			type: "string",
			required: true,
		},
	},
	async *call({ prompt }, { conv }) {
		const app = await Client.connect("ByteDance/Hyper-SDXL-1Step-T2I", {
			hf_token: (env.HF_TOKEN ?? env.HF_ACCESS_TOKEN) as unknown as `hf_${string}`,
		});
		const res = (await app.predict("/process_image", [
			1, // number (numeric value between 1 and 8) in 'Number of Images' Slider component
			512, // number in 'Image Height' Number component
			512, // number in 'Image Width' Number component
			prompt, // prompt
			Math.floor(Math.random() * 1000), // seed random
		])) as unknown as { data: { image: { url: string } }[][] };

		const response = await fetch(res?.data?.[0]?.[0]?.image?.url ?? "error");

		const sha = await uploadFile(await response.blob(), conv);

		yield { type: MessageUpdateType.File, sha };

		return {
			status: ToolResultStatus.Success,
			outputs: [
				{
					text2img: `An image has been generated for the following prompt: "${prompt}". Answer as if the user can already see the image. Do not try to insert the image or to add space for it. The user can already see the image. Do not try to describe the image as you the model cannot see it.`,
				},
			],
			display: false,
		};
	},
};

export default text2img;
