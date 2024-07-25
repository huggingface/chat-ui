interface EmbeddingEndpointTei {
	type: "tei";
	weight: number;
	url: string;
	authorization?: string;
}

interface EmbeddingEndpointTransformersjs {
	type: "transformersjs";
	weight: number;
}

interface EmbeddingEndpointOpenai {
	type: "openai";
	weight: number;
	url: string;
	apiKey: string;
	defaultHeaders: Record<string, string>;
}

interface EmbeddingEndpointHfApi {
	type: "hfapi";
	weight: number;
	authorization?: string;
}

export type EmbeddingEndpoint =
	| EmbeddingEndpointTei
	| EmbeddingEndpointTransformersjs
	| EmbeddingEndpointOpenai
	| EmbeddingEndpointHfApi;
