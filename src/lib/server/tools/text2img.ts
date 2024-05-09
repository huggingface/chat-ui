import type { BackendTool } from ".";

const text2img: BackendTool = {
	name: "text2img",
	displayName: "Text to Image",
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
};

export default text2img;
