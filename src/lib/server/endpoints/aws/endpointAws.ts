import { buildPrompt } from "$lib/buildPrompt";
import { textGenerationStream } from "@huggingface/inference";
import { z } from "zod";
import type { Endpoint } from "../endpoints";

export const endpointAwsParametersSchema = z.object({
	weight: z.number().int().positive().default(1),
	model: z.any(),
	type: z.literal("aws"),
	url: z.string().url(),
	accessKey: z
		.string({
			description:
				"An AWS Access Key ID. If not provided, the default AWS identity resolution will be used",
		})
		.min(1)
		.optional(),
	secretKey: z
		.string({
			description:
				"An AWS Access Key Secret. If not provided, the default AWS identity resolution will be used",
		})
		.min(1)
		.optional(),
	sessionToken: z.string().optional(),
	service: z.union([z.literal("sagemaker"), z.literal("lambda")]).default("sagemaker"),
	region: z.string().optional(),
});

export async function endpointAws(
	input: z.input<typeof endpointAwsParametersSchema>
): Promise<Endpoint> {
	let createSignedFetcher;
	try {
		createSignedFetcher = (await import("aws-sigv4-fetch")).createSignedFetcher;
	} catch (e) {
		throw new Error("Failed to import aws-sigv4-fetch");
	}

	const { url, accessKey, secretKey, sessionToken, model, region, service } =
		endpointAwsParametersSchema.parse(input);

	const signedFetch = createSignedFetcher({
		service,
		region,
		credentials:
			accessKey && secretKey
				? { accessKeyId: accessKey, secretAccessKey: secretKey, sessionToken }
				: undefined,
	});

	return async ({ messages, preprompt, continueMessage, generateSettings }) => {
		const prompt = await buildPrompt({
			messages,
			continueMessage,
			preprompt,
			model,
		});

		return textGenerationStream(
			{
				parameters: { ...model.parameters, ...generateSettings, return_full_text: false },
				model: url,
				inputs: prompt,
			},
			{
				use_cache: false,
				fetch: signedFetch,
			}
		);
	};
}

export default endpointAws;
