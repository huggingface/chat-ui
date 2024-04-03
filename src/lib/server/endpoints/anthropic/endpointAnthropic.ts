import { z } from "zod";
import { ANTHROPIC_API_KEY } from "$env/static/private";
import type { Endpoint } from "../endpoints";
import type { TextGenerationStreamOutput } from "@huggingface/inference";

export const endpointAnthropicParametersSchema = z.object({
	weight: z.number().int().positive().default(1),
	model: z.any(),
	type: z.literal("anthropic"),
	baseURL: z.string().url().default("https://api.anthropic.com"),
	apiKey: z.string().default(ANTHROPIC_API_KEY ?? "sk-"),
	defaultHeaders: z.record(z.string()).optional(),
	defaultQuery: z.record(z.string()).optional(),
});

export async function endpointAnthropic(
	input: z.input<typeof endpointAnthropicParametersSchema>
): Promise<Endpoint> {
	const { baseURL, apiKey, model, defaultHeaders, defaultQuery } =
		endpointAnthropicParametersSchema.parse(input);
	let Anthropic;
	try {
		Anthropic = (await import("@anthropic-ai/sdk")).default;
	} catch (e) {
		throw new Error("Failed to import @anthropic-ai/sdk", { cause: e });
	}

	const anthropic = new Anthropic({
		apiKey,
		baseURL,
		defaultHeaders,
		defaultQuery,
	});

	return async ({ messages, preprompt, generateSettings }) => {
		let system = preprompt;
		if (messages?.[0]?.from === "system") {
			system = messages[0].content;
		}

		const messagesFormatted = messages
			.filter((message) => message.from !== "system")
			.map((message) => ({
				role: message.from,
				content: message.content,
			})) as unknown as {
			role: "user" | "assistant";
			content: string;
		}[];

		let tokenId = 0;

		const parameters = { ...model.parameters, ...generateSettings };

		return (async function* () {
			const stream = anthropic.messages.stream({
				model: model.id ?? model.name,
				messages: messagesFormatted,
				max_tokens: parameters?.max_new_tokens,
				temperature: parameters?.temperature,
				top_p: parameters?.top_p,
				top_k: parameters?.top_k,
				stop_sequences: parameters?.stop,
				system,
			});
			while (true) {
				const result = await Promise.race([stream.emitted("text"), stream.emitted("end")]);

				// Stream end
				if (result === undefined) {
					yield {
						token: {
							id: tokenId++,
							text: "",
							logprob: 0,
							special: true,
						},
						generated_text: await stream.finalText(),
						details: null,
					} satisfies TextGenerationStreamOutput;
					return;
				}

				// Text delta
				yield {
					token: {
						id: tokenId++,
						text: result as unknown as string,
						special: false,
						logprob: 0,
					},
					generated_text: null,
					details: null,
				} satisfies TextGenerationStreamOutput;
			}
		})();
	};
}
