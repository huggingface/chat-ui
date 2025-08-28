import { z } from "zod";
import { config } from "$lib/server/config";
import type { Endpoint } from "../endpoints";
import type { TextGenerationStreamOutput } from "@huggingface/inference";
import type { Cohere, CohereClient } from "cohere-ai";
import { buildPrompt } from "$lib/buildPrompt";
import { pipeline, Writable, type Readable } from "node:stream";
// Tools feature removed

export const endpointCohereParametersSchema = z.object({
	weight: z.number().int().positive().default(1),
	model: z.any(),
	type: z.literal("cohere"),
	apiKey: z.string().default(config.COHERE_API_TOKEN),
	clientName: z.string().optional(),
	raw: z.boolean().default(false),
	forceSingleStep: z.boolean().default(true),
});

export async function endpointCohere(
	input: z.input<typeof endpointCohereParametersSchema>
): Promise<Endpoint> {
	const { apiKey, clientName, model, raw, forceSingleStep } =
		endpointCohereParametersSchema.parse(input);

	let cohere: CohereClient;

	try {
		cohere = new (await import("cohere-ai")).CohereClient({
			token: apiKey,
			clientName,
		});
	} catch (e) {
		throw new Error("Failed to import cohere-ai", { cause: e });
	}

    return async ({ messages, preprompt, generateSettings, continueMessage }) => {
        let system = preprompt;
        if (messages?.[0]?.from === "system") {
            system = messages[0].content;
        }

        const parameters = { ...model.parameters, ...generateSettings };

        return (async function* () {
            let stream;
            let tokenId = 0;

            if (raw) {
                const prompt = await buildPrompt({
                    messages,
                    model,
                    preprompt: system,
                    continueMessage,
                });

                stream = await cohere.chatStream({
                    forceSingleStep,
                    message: prompt,
					rawPrompting: true,
					model: model.id ?? model.name,
					p: parameters?.top_p,
					k: parameters?.top_k,
					maxTokens: parameters?.max_new_tokens,
					temperature: parameters?.temperature,
					stopSequences: parameters?.stop,
					frequencyPenalty: parameters?.frequency_penalty,
				});
			} else {
				const formattedMessages = messages
					.filter((message) => message.from !== "system")
					.map((message) => ({
						role: message.from === "user" ? "USER" : "CHATBOT",
						message: message.content,
					})) satisfies Cohere.Message[];

				stream = await cohere
					.chatStream({
						forceSingleStep,
						model: model.id ?? model.name,
						chatHistory: formattedMessages.slice(0, -1),
						message: formattedMessages[formattedMessages.length - 1].message,
						preamble: system,
						p: parameters?.top_p,
						k: parameters?.top_k,
						maxTokens: parameters?.max_new_tokens,
						temperature: parameters?.temperature,
						stopSequences: parameters?.stop,
						frequencyPenalty: parameters?.frequency_penalty,
                })
                    .catch(async (err) => {
                        if (!err.body) throw err;

						// Decode the error message and throw
						const message = await convertStreamToBuffer(err.body).catch(() => {
							throw err;
						});
						throw Error(message, { cause: err });
					});
			}

			for await (const output of stream) {
				if (output.eventType === "text-generation") {
					yield {
						token: {
							id: tokenId++,
							text: output.text,
							logprob: 0,
							special: false,
						},
						generated_text: null,
						details: null,
					} satisfies TextGenerationStreamOutput;
                } else if (output.eventType === "stream-end") {
                    if (["ERROR", "ERROR_TOXIC", "ERROR_LIMIT"].includes(output.finishReason)) {
                        throw new Error(output.finishReason);
                    }
					yield {
						token: {
							id: tokenId++,
							text: "",
							logprob: 0,
							special: true,
						},
						generated_text: output.response.text,
						details: null,
					};
				}
			}
		})();
	};
}

async function convertStreamToBuffer(webReadableStream: Readable) {
	return new Promise<string>((resolve, reject) => {
		const chunks: Buffer[] = [];

		pipeline(
			webReadableStream,
			new Writable({
				write(chunk, _, callback) {
					chunks.push(chunk);
					callback();
				},
			}),
			(err) => {
				if (err) {
					reject(err);
				} else {
					resolve(Buffer.concat(chunks).toString("utf-8"));
				}
			}
		);
	});
}
