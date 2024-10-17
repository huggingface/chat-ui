import { z } from "zod";
import { validModelIdSchema, models } from "./models";
import { validToolIdSchema } from "./tools";
import JSON5 from "json5";
import { env } from "$env/dynamic/private";

const basePromptSchema = z.object({
	title: z.string(),
	prompt: z.string(),
	models: z.array(validModelIdSchema).optional(),
});

const multimodalPromptSchema = basePromptSchema.extend({
	type: z.literal("multimodal"),
	fileUrl: z.string().url(),
});

const toolPromptSchema = basePromptSchema.extend({
	type: z.literal("tool"),
	toolId: validToolIdSchema,
	fileUrl: z.string().url().optional(),
});

const simplePromptSchema = basePromptSchema
	.extend({
		type: z.literal("simple").optional(),
	})
	.transform((data) => ({
		...data,
		type: data,
	}));

const promptExamplesSchema = z.array(
	z.union([multimodalPromptSchema, toolPromptSchema, simplePromptSchema])
);

export type PromptExample = z.infer<typeof promptExamplesSchema>[number];

// parse the prompt examples from the environment variable
const promptExamples = promptExamplesSchema.parse(JSON5.parse(env.PROMPT_EXAMPLES));

// add model specific prompt examples for legacy configs
const modelSpecificPromptExamples = models
	.filter((model) => !!model.promptExamples)
	.map((model) =>
		model.promptExamples?.map((example) => ({
			...example,
			models: [model.id],
		}))
	)
	.flat();

const combinedPromptExamples = [...promptExamples, ...modelSpecificPromptExamples];

export { combinedPromptExamples as promptExamples };
