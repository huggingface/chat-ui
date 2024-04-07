import type { z } from "zod";
import type { modelConfig } from "./src/lib/server/models";

type ModelType = z.input<typeof modelConfig>;

// Define models with IDE type hinting and auto-completion
// No need to wrap in extra quotes or JSON.parse issues.
// Could also remove JSON5 dependency from the project.

// Issue to solve here is how to provide the type support AND
// also keep the models in a separate file, that is not git-tracked.
const models: ModelType[] = [
	{
		name: "gpt-4-turbo-preview",
		displayName: "gpt-4-turbo-preview",
		description: "A genius with inside a gold-fish brain.",
		websiteUrl: "https://platform.openai.com/docs/models/gpt-4-and-gpt-4-turbo",
		parameters: {
			temperature: 0.5,
			max_new_tokens: 4096,
		},
		endpoints: [
			{
				type: "openai",
			},
		],
	},

	{
		name: "claude-3-sonnet-20240229",
		displayName: "Claude 3 Sonnet",
		description: "Ideal balance of intelligence and speed",
		parameters: {
			max_new_tokens: 4096,
		},
		endpoints: [
			{
				type: "anthropic",
				apiKey: "sk-ant-...",
			},
		],
	},
	{
		name: "mistral-large-2402",
		displayName: "Mistral Large",
		description:
			"French ain't letting the Americans have all the fun. Mistral is a French AI model... and it's pretty good.",
		logoUrl: "https://mistral.ai/images/news/announcing-mistral.png?",
		websiteUrl: "https://docs.mistral.ai/guides/model-selection/",
		parameters: {
			temperature: 0.5,
			max_new_tokens: 4096,
		},
		endpoints: [
			{
				type: "openai",
				baseURL: "https://mistral-large-2402-serverless.francecentral.inference.ai.azure.com/v1",
			},
		],
	},
	{
		name: "gemini-1.0-pro",
		displayName: "Vertex Gemini Pro 1.0",
		endpoints: [
			{
				type: "vertex",
				model: "gemini-1.0-pro",
				location: "europe-west3",
				project: "ground-runner",
			},
		],
	},
];

export default models;
