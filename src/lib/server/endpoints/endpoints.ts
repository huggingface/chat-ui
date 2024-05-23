import type { Conversation } from "$lib/types/Conversation";
import type { Message } from "$lib/types/Message";
import type { TextGenerationStreamOutput, TextGenerationStreamToken } from "@huggingface/inference";
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
import {
	endpointAnthropicVertex,
	endpointAnthropicVertexParametersSchema,
} from "./anthropic/endpointAnthropicVertex";
import type { Model } from "$lib/types/Model";
import endpointCloudflare, {
	endpointCloudflareParametersSchema,
} from "./cloudflare/endpointCloudflare";
import { endpointCohere, endpointCohereParametersSchema } from "./cohere/endpointCohere";
import endpointLangserve, {
	endpointLangserveParametersSchema,
} from "./langserve/endpointLangserve";

import type { Tool, ToolCall, ToolResult } from "$lib/types/Tool";

export type EndpointMessage = Omit<Message, "id">;

// parameters passed when generating text
export interface EndpointParameters {
	messages: EndpointMessage[];
	preprompt?: Conversation["preprompt"];
	continueMessage?: boolean; // used to signal that the last message will be extended
	generateSettings?: Partial<Model["parameters"]>;
	tools?: Tool[];
	toolResults?: ToolResult[];
	isMultimodal?: boolean;
}

interface CommonEndpoint {
	weight: number;
}
type TextGenerationStreamOutputWithTools = TextGenerationStreamOutput & {
	token: TextGenerationStreamToken & { toolCalls?: ToolCall[] };
};
// type signature for the endpoint
export type Endpoint = (
	params: EndpointParameters
) => Promise<AsyncGenerator<TextGenerationStreamOutputWithTools, void, void>>;

// generator function that takes in parameters for defining the endpoint and return the endpoint
export type EndpointGenerator<T extends CommonEndpoint> = (parameters: T) => Endpoint;

// list of all endpoint generators
export const endpoints = {
	tgi: endpointTgi,
	anthropic: endpointAnthropic,
	anthropicvertex: endpointAnthropicVertex,
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
	endpointAnthropicVertexParametersSchema,
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
