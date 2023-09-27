import { SERPAPI_KEY, SERPER_API_KEY, TOOLS } from "$env/static/private";
import { z } from "zod";

const webSearchTool = z.object({
	name: z.literal("webSearch"),
	key: z.union([
		z.object({
			type: z.literal("serpapi"),
			apiKey: z.string().min(1).default(SERPAPI_KEY),
		}),
		z.object({
			type: z.literal("serper"),
			apiKey: z.string().min(1).default(SERPER_API_KEY),
		}),
	]),
});

const textToImageTool = z.object({
	name: z.literal("textToImage"),
	model: z.string().min(1).default("stabilityai/stable-diffusion-xl-base-1.0"),
	parameters: z.optional(
		z.object({
			negative_prompt: z.string().optional(),
			height: z.number().optional(),
			width: z.number().optional(),
			num_inference_steps: z.number().optional(),
			guidance_scale: z.number().optional(),
		})
	),
});

const toolsDefinition = z.array(z.discriminatedUnion("name", [webSearchTool, textToImageTool]));

export const tools = toolsDefinition.parse(JSON.parse(TOOLS));

// check if SERPAPI_KEY or SERPER_API_KEY are defined, and if so append them to the tools

if (SERPAPI_KEY) {
	tools.push({
		name: "webSearch",
		key: {
			type: "serpapi",
			apiKey: SERPAPI_KEY,
		},
	});
} else if (SERPER_API_KEY) {
	tools.push({
		name: "webSearch",
		key: {
			type: "serper",
			apiKey: SERPER_API_KEY,
		},
	});
}

export type Tool = z.infer<typeof toolsDefinition>[number];
export type WebSearchTool = z.infer<typeof webSearchTool>;
export type TextToImageTool = z.infer<typeof textToImageTool>;
