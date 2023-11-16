import type { Conversation } from "$lib/types/Conversation";
import type { TextGenerationStreamOutput } from "@huggingface/inference";
import { endpointTgi, endpointTgiParametersSchema } from "./tgi/endpointTgi";
import { z } from "zod";
import endpointAws, { endpointAwsParametersSchema } from "./aws/endpointAws";
import { endpointOAIParametersSchema, endpointOai } from "./openai/endpointOai";
import endpointLlamacpp, { endpointLlamacppParametersSchema } from "./llamacpp/endpointLlamacpp";

// parameters passed when generating text
interface EndpointParameters {
	conversation: {
		messages: Omit<Conversation["messages"][0], "id">[];
		preprompt?: Conversation["preprompt"];
		_id?: Conversation["_id"];
	};
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
	aws: endpointAws,
	openai: endpointOai,
	llamacpp: endpointLlamacpp,
};

export const endpointSchema = z.discriminatedUnion("type", [
	endpointAwsParametersSchema,
	endpointOAIParametersSchema,
	endpointTgiParametersSchema,
	endpointLlamacppParametersSchema,
]);
export default endpoints;
