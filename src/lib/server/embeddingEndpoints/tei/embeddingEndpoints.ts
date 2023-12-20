import { z } from "zod";
import type { EmbeddingEndpoint } from "../embeddingEndpoints";

export const embeddingEndpointTeiParametersSchema = z.object({
	weight: z.number().int().positive().default(1),
	model: z.any(),
	type: z.literal("tei"),
	url: z.string().url(),
});

export function embeddingEndpointTei(
	input: z.input<typeof embeddingEndpointTeiParametersSchema>
): EmbeddingEndpoint {
	const { url } = embeddingEndpointTeiParametersSchema.parse(input);
	return async ({ inputs }) => {
		const { origin } = new URL(url);

		const response = await fetch(`${origin}/embed`, {
			method: "POST",
			headers: {
				Accept: "application/json",
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ inputs, normalize: true, truncate: true }),
		});

		return response.json();
	};
}

export default embeddingEndpointTei;
