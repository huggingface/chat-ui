import {
	VertexAI,
	HarmCategory,
	HarmBlockThreshold,
	type Content,
	type TextPart,
	FunctionDeclarationSchemaType,
	type FunctionDeclarationSchema,
	type FunctionDeclarationSchemaProperty,
	type Tool,
	type FunctionDeclarationsTool,
	type FunctionDeclaration,
	type GoogleSearchRetrievalTool,
	type GoogleSearchRetrieval,
	type RetrievalTool,
	type Retrieval,
	type VertexAISearch,
} from "@google-cloud/vertexai";
import type { Endpoint } from "../endpoints";
import { z } from "zod";
import type { Message } from "$lib/types/Message";
import type { TextGenerationStreamOutput } from "@huggingface/inference";

const vertexAISearchSchema: z.ZodType<VertexAISearch> = z.object({
	datastore: z.string(),
});

const retrievalSchema: z.ZodType<Retrieval> = z.object({
	vertexAiSearch: vertexAISearchSchema.optional(),
	disableAttribution: z.boolean().optional(),
});

const retrievalToolSchema: z.ZodType<RetrievalTool> = z.object({
	retrieval: retrievalSchema.optional(),
});

const googleSearchRetrievalSchema: z.ZodType<GoogleSearchRetrieval> = z.object({
	disableAttribution: z.boolean().optional(),
});

const googleSearchRetrievalToolSchema: z.ZodType<GoogleSearchRetrievalTool> = z.object({
	googleSearchRetrieval: googleSearchRetrievalSchema.optional(),
});

const functionDeclarationSchemaTypeSchema = z.nativeEnum(FunctionDeclarationSchemaType);

const functionDeclarationSchemaPropertySchema: z.ZodType<FunctionDeclarationSchemaProperty> =
	z.object({
		type: functionDeclarationSchemaTypeSchema.optional(),
		format: z.string().optional(),
		description: z.string().optional(),
		nullable: z.boolean().optional(),
		items: z.lazy(() => functionDeclarationSchemaSchema),
		enum: z.array(z.string()).optional(),
		properties: z.lazy(() => z.record(z.string(), functionDeclarationSchemaSchema)),
		required: z.array(z.string()).optional(),
		example: z.unknown().optional(),
	});

const functionDeclarationSchemaSchema: z.ZodType<FunctionDeclarationSchema> = z.object({
	type: functionDeclarationSchemaTypeSchema,
	properties: z.lazy(() => z.record(z.string(), functionDeclarationSchemaPropertySchema)),
	description: z.string().optional(),
	required: z.array(z.string()).optional(),
});

const functionDeclarationSchema: z.ZodType<FunctionDeclaration> = z.object({
	name: z.string(),
	description: z.string().optional(),
	parameters: functionDeclarationSchemaSchema.optional(),
});

const functionDeclarationsToolSchema: z.ZodType<FunctionDeclarationsTool> = z.object({
	functionDeclarations: z.array(functionDeclarationSchema).optional(),
});

const toolSchema: z.ZodType<Tool> = z.union([
	functionDeclarationsToolSchema,
	retrievalToolSchema,
	googleSearchRetrievalToolSchema,
]);

export const endpointVertexParametersSchema = z.object({
	weight: z.number().int().positive().default(1),
	model: z.any(), // allow optional and validate against emptiness
	type: z.literal("vertex"),
	location: z.string().default("europe-west1"),
	project: z.string(),
	apiEndpoint: z.string().optional(),
	safetyThreshold: z
		.enum([
			HarmBlockThreshold.HARM_BLOCK_THRESHOLD_UNSPECIFIED,
			HarmBlockThreshold.BLOCK_LOW_AND_ABOVE,
			HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
			HarmBlockThreshold.BLOCK_NONE,
			HarmBlockThreshold.BLOCK_ONLY_HIGH,
		])
		.optional(),
	tools: toolSchema.array().optional(),
});

export function endpointVertex(input: z.input<typeof endpointVertexParametersSchema>): Endpoint {
	const { project, location, model, apiEndpoint, safetyThreshold, tools } =
		endpointVertexParametersSchema.parse(input);

	const vertex_ai = new VertexAI({
		project,
		location,
		apiEndpoint,
	});

	return async ({ messages, preprompt, generateSettings }) => {
		const generativeModel = vertex_ai.getGenerativeModel({
			model: model.id ?? model.name,
			safetySettings: safetyThreshold
				? [
						{
							category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
							threshold: safetyThreshold,
						},
						{
							category: HarmCategory.HARM_CATEGORY_HARASSMENT,
							threshold: safetyThreshold,
						},
						{
							category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
							threshold: safetyThreshold,
						},
						{
							category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
							threshold: safetyThreshold,
						},
						{
							category: HarmCategory.HARM_CATEGORY_UNSPECIFIED,
							threshold: safetyThreshold,
						},
				  ]
				: undefined,
			generationConfig: {
				maxOutputTokens: generateSettings?.max_new_tokens ?? 4096,
				stopSequences: generateSettings?.stop,
				temperature: generateSettings?.temperature ?? 1,
			},
			tools,
		});

		// Preprompt is the same as the first system message.
		let systemMessage = preprompt;
		if (messages[0].from === "system") {
			systemMessage = messages[0].content;
			messages.shift();
		}

		const vertexMessages = messages.map(({ from, content }: Omit<Message, "id">): Content => {
			return {
				role: from === "user" ? "user" : "model",
				parts: [
					{
						text: content,
					},
				],
			};
		});

		const result = await generativeModel.generateContentStream({
			contents: vertexMessages,
			systemInstruction: systemMessage
				? {
						role: "system",
						parts: [
							{
								text: systemMessage,
							},
						],
				  }
				: undefined,
		});

		let tokenId = 0;
		return (async function* () {
			let generatedText = "";

			for await (const data of result.stream) {
				if (!data?.candidates?.length) break; // Handle case where no candidates are present

				const candidate = data.candidates[0];
				if (!candidate.content?.parts?.length) continue; // Skip if no parts are present

				const firstPart = candidate.content.parts.find((part) => "text" in part) as
					| TextPart
					| undefined;
				if (!firstPart) continue; // Skip if no text part is found

				const isLastChunk = !!candidate.finishReason;

				const content = firstPart.text;
				generatedText += content;
				const output: TextGenerationStreamOutput = {
					token: {
						id: tokenId++,
						text: content,
						logprob: 0,
						special: isLastChunk,
					},
					generated_text: isLastChunk ? generatedText : null,
					details: null,
				};
				yield output;

				if (isLastChunk) break;
			}
		})();
	};
}
export default endpointVertex;
