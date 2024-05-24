import type { BackendTool } from "..";
import { uploadFile } from "../../files/uploadFile";
import { ToolResultStatus } from "$lib/types/Tool";
import { MessageUpdateType } from "$lib/types/MessageUpdate";
import { callSpace, type GradioImage } from "../utils";
import { downloadFile } from "$lib/server/files/downloadFile";

type ImageEditingInput = [
	Blob /* image */,
	string /* prompt */,
	string /* negative prompt */,
	number /* guidance scale */,
	number /* steps */
];
type ImageEditingOutput = [GradioImage];

const imageEditing: BackendTool = {
	name: "image_editing",
	displayName: "Image Editing",
	description: "Use this tool to edit an image from a prompt.",
	isOnByDefault: true,
	parameterDefinitions: {
		prompt: {
			description:
				"A prompt to generate an image from. Describe the image visually in simple terms, separate terms with a comma.",
			type: "string",
			required: true,
		},
		fileMessageIndex: {
			description: "Index of the message containing the file to edit",
			type: "number",
			required: true,
		},
		fileIndex: {
			description: "Index of the file to edit",
			type: "number",
			required: true,
		},
	},
	async *call({ prompt, fileMessageIndex, fileIndex }, { conv, messages }) {
		prompt = String(prompt);
		fileMessageIndex = Number(fileMessageIndex);
		fileIndex = Number(fileIndex);

		const message = messages[fileMessageIndex];
		const images = message?.files ?? [];
		if (!images || images.length === 0) {
			return {
				status: ToolResultStatus.Error,
				message: "User did not provide an image to edit.",
			};
		}
		if (fileIndex >= images.length) {
			return {
				status: ToolResultStatus.Error,
				message: "Model provided an invalid file index",
			};
		}
		if (!images[fileIndex].mime.startsWith("image/")) {
			return {
				status: ToolResultStatus.Error,
				message: "Model provided a file indx which is not an image",
			};
		}

		// todo: should handle multiple images
		const image = await downloadFile(images[fileIndex].value, conv._id)
			.then((file) => fetch(`data:${file.mime};base64,${file.value}`))
			.then((res) => res.blob());

		const outputs = await callSpace<ImageEditingInput, ImageEditingOutput>(
			"multimodalart/cosxl",
			"run_edit",
			[
				image,
				prompt,
				"", // negative prompt
				7, // guidance scale
				20, // steps
			]
		);

		const outputImage = await fetch(outputs[0].url)
			.then((res) => res.blob())
			.then((blob) => new File([blob], outputs[0].orig_name, { type: blob.type }))
			.then((file) => uploadFile(file, conv));

		yield {
			type: MessageUpdateType.File,
			name: outputImage.name,
			sha: outputImage.value,
			mime: outputImage.mime,
		};

		return {
			status: ToolResultStatus.Success,
			outputs: [
				{
					imageEditing: `An image has been generated for the following prompt: "${prompt}". Answer as if the user can already see the image. Do not try to insert the image or to add space for it. The user can already see the image. Do not try to describe the image as you the model cannot see it.`,
				},
			],
			display: false,
		};
	},
};

export default imageEditing;
