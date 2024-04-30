import type { Conversation } from "$lib/types/Conversation";
import type { TextGenerationStreamOutput } from "@huggingface/inference";
import { endpointTgi, endpointTgiParametersSchema } from "./tgi/endpointTgi";
import { z } from "zod";
import endpointAws, { endpointAwsParametersSchema } from "./aws/endpointAws";
import { endpointOAIParametersSchema, endpointOai } from "./openai/endpointOai";
import endpointLlamacpp, { endpointLlamacppParametersSchema } from "./llamacpp/endpointLlamacpp";
import endpointOllama, { endpointOllamaParametersSchema } from "./ollama/endpointOllama";
import endpointVertex, { endpointVertexParametersSchema } from "./google/endpointVertex";

import {
	endpointAnthropic,
	endpointAnthropicParametersSchema,
} from "./anthropic/endpointAnthropic";
import type { Model } from "$lib/types/Model";
import endpointCloudflare, {
	endpointCloudflareParametersSchema,
} from "./cloudflare/endpointCloudflare";
import { endpointCohere, endpointCohereParametersSchema } from "./cohere/endpointCohere";
import endpointLangserve, {
	endpointLangserveParametersSchema,
} from "./langserve/endpointLangserve";

// parameters passed when generating text
export interface EndpointParameters {
	messages: Omit<Conversation["messages"][0], "id">[];
	preprompt?: Conversation["preprompt"];
	continueMessage?: boolean; // used to signal that the last message will be extended
	generateSettings?: Partial<Model["parameters"]>;
}

interface CommonEndpoint {
	weight: number;
}
// type signature for the endpoint
export type Endpoint = (
	params: EndpointParameters
) => Promise<AsyncGenerator<TextGenerationStreamOutput, void, void>>;

// generator function that takes in parameters for defining the endpoint and return the endpoint
export type EndpointGenerator<T extends CommonEndpoint> = (parameters: T) => Endpoint;

// list of all endpoint generators
export const endpoints = {
	tgi: endpointTgi,
	anthropic: endpointAnthropic,
	aws: endpointAws,
	openai: endpointOai,
	llamacpp: endpointLlamacpp,
	ollama: endpointOllama,
	vertex: endpointVertex,
	cloudflare: endpointCloudflare,
	cohere: endpointCohere,
	langserve: endpointLangserve,
};

export const endpointSchema = z.discriminatedUnion("type", [
	endpointAnthropicParametersSchema,
	endpointAwsParametersSchema,
	endpointOAIParametersSchema,
	endpointTgiParametersSchema,
	endpointLlamacppParametersSchema,
	endpointOllamaParametersSchema,
	endpointVertexParametersSchema,
	endpointCloudflareParametersSchema,
	endpointCohereParametersSchema,
	endpointLangserveParametersSchema,
]);
export default endpoints;
