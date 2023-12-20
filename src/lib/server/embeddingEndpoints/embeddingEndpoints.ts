import {
	embeddingEndpointTei,
	embeddingEndpointTeiParametersSchema,
} from "./tei/embeddingEndpoints";
import { z } from "zod";
import embeddingEndpointXenova, {
	embeddingEndpointXenovaParametersSchema,
} from "./xenova/embeddingEndpoints";

// parameters passed when generating text
interface EmbeddingEndpointParameters {
	inputs: string[];
}

interface CommonEmbeddingEndpoint {
	weight: number;
}

// type signature for the endpoint
export type EmbeddingEndpoint = (params: EmbeddingEndpointParameters) => Promise<number[][]>;

// generator function that takes in parameters for defining the endpoint and return the endpoint
export type EmbeddingEndpointGenerator<T extends CommonEmbeddingEndpoint> = (
	parameters: T
) => EmbeddingEndpoint;

// list of all endpoint generators
export const embeddingEndpoints = {
	tei: embeddingEndpointTei,
	xenova: embeddingEndpointXenova,
};

export const embeddingEndpointSchema = z.discriminatedUnion("type", [
	embeddingEndpointTeiParametersSchema,
	embeddingEndpointXenovaParametersSchema,
]);

export default embeddingEndpoints;
