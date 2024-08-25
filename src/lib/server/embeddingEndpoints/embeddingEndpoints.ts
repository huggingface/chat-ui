import { z } from "zod";
import {
	embeddingEndpointTei,
	embeddingEndpointTeiParametersSchema,
} from "./tei/embeddingEndpoints";
import {
	embeddingEndpointTransformersJS,
	embeddingEndpointTransformersJSParametersSchema,
} from "./transformersjs/embeddingEndpoints";
import {
	embeddingEndpointOpenAI,
	embeddingEndpointOpenAIParametersSchema,
} from "./openai/embeddingEndpoints";
import { embeddingEndpointHfApi, embeddingEndpointHfApiSchema } from "./hfApi/embeddingHfApi";

// parameters passed when generating text
interface EmbeddingEndpointParameters {
	inputs: string[];
}

export type Embedding = number[];

// type signature for the endpoint
export type EmbeddingEndpoint = (params: EmbeddingEndpointParameters) => Promise<Embedding[]>;

export const embeddingEndpointSchema = z.discriminatedUnion("type", [
	embeddingEndpointTeiParametersSchema,
	embeddingEndpointTransformersJSParametersSchema,
	embeddingEndpointOpenAIParametersSchema,
	embeddingEndpointHfApiSchema,
]);

type EmbeddingEndpointTypeOptions = z.infer<typeof embeddingEndpointSchema>["type"];

// generator function that takes in type discrimantor value for defining the endpoint and return the endpoint
export type EmbeddingEndpointGenerator<T extends EmbeddingEndpointTypeOptions> = (
	inputs: Extract<z.infer<typeof embeddingEndpointSchema>, { type: T }>
) => EmbeddingEndpoint | Promise<EmbeddingEndpoint>;

// list of all endpoint generators
export const embeddingEndpoints: {
	[Key in EmbeddingEndpointTypeOptions]: EmbeddingEndpointGenerator<Key>;
} = {
	tei: embeddingEndpointTei,
	transformersjs: embeddingEndpointTransformersJS,
	openai: embeddingEndpointOpenAI,
	hfapi: embeddingEndpointHfApi,
};

export default embeddingEndpoints;
