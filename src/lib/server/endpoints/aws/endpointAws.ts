import { buildPrompt } from "$lib/buildPrompt";
import { textGenerationStream } from "@huggingface/inference";
import { z } from "zod";
import type { Endpoint } from "../endpoints";

export const endpointAwsParametersSchema = z.object({
	weight: z.number().int().positive().default(1),
	model: z.any(),
	type: z.literal("aws"),
	url: z.string().url(),
	accessKey: z.string().min(1),
	secretKey: z.string().min(1),
	sessionToken: z.string().optional(),
	service: z.union([z.literal("sagemaker"), z.literal("lambda")]).default("sagemaker"),
	region: z.string().optional(),
});

export async function endpointAws({
	url,
	accessKey,
	secretKey,
	sessionToken,
	model,
	region,
	service,
}: z.infer<typeof endpointAwsParametersSchema>): Promise<Endpoint> {
	let AwsClient;
	try {
		AwsClient = (await import("aws4fetch")).AwsClient;
	} catch (e) {
		throw new Error("Failed to import aws4fetch");
	}

	const aws = new AwsClient({
		accessKeyId: accessKey,
		secretAccessKey: secretKey,
		sessionToken,
		service,
		region,
	});

	return async ({ conversation }) => {
		const prompt = await buildPrompt({
			messages: conversation.messages,
			webSearch: conversation.messages[conversation.messages.length - 1].webSearch,
			preprompt: conversation.preprompt,
			model,
		});

		return textGenerationStream(
			{
				parameters: { ...model.parameters, return_full_text: false },
				model: url,
				inputs: prompt,
			},
			{
				use_cache: false,
				fetch: aws.fetch.bind(aws) as typeof fetch,
			}
		);
	};
}

export default endpointAws;
