import { buildPrompt } from "$lib/buildPrompt";
import { textGenerationStream } from "@huggingface/inference";
import { z } from "zod";
import type { Endpoint } from "../endpoints";

const AwsClient = (await import("aws4fetch")).AwsClient;

export const endpointAwsParametersSchema = z.object({
	weight: z.number().int().positive().default(1),
	model: z.any(),
	type: z.literal("sagemaker"),
	url: z.string().url(),
	accessKey: z.string().min(1),
	secretKey: z.string().min(1),
	sessionToken: z.string().optional(),
});

export function endpointAws({
	url,
	accessKey,
	secretKey,
	sessionToken,
	model,
}: z.infer<typeof endpointAwsParametersSchema>): Endpoint {
	const aws = new AwsClient({
		accessKeyId: accessKey,
		secretAccessKey: secretKey,
		sessionToken: sessionToken,
		service: "sagemaker",
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
