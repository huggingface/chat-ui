import type { Conversation } from "$lib/types/Conversation";
import type { Message } from "$lib/types/Message";
import type { TextGenerationStreamOutput, TextGenerationStreamToken } from "@huggingface/inference";
import { z } from "zod";
import { endpointOAIParametersSchema, endpointOai } from "./openai/endpointOai";
import type { Model } from "$lib/types/Model";
import type { ObjectId } from "mongodb";

export type EndpointMessage = Omit<Message, "id">;

// parameters passed when generating text
export interface EndpointParameters {
	messages: EndpointMessage[];
	preprompt?: Conversation["preprompt"];
	continueMessage?: boolean; // used to signal that the last message will be extended
	generateSettings?: Partial<Model["parameters"]>;
	isMultimodal?: boolean;
	conversationId?: ObjectId;
}

export type TextGenerationStreamOutputSimplified = TextGenerationStreamOutput & {
	token: TextGenerationStreamToken;
	routerMetadata?: { route?: string; model?: string };
};
// type signature for the endpoint
export type Endpoint = (
	params: EndpointParameters
) => Promise<AsyncGenerator<TextGenerationStreamOutputSimplified, void, void>>;

// list of all endpoint generators
export const endpoints = {
	openai: endpointOai,
};

export const endpointSchema = z.discriminatedUnion("type", [endpointOAIParametersSchema]);
export default endpoints;
