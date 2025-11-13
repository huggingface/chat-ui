import { models } from "$lib/server/models";

const dummyModel = {
	id: "dummy-model",
	name: "dummy-model",
	websiteUrl: "https://huggingface.co",
	modelUrl: "https://huggingface.co",
	datasetName: undefined,
	datasetUrl: undefined,
	displayName: "Dummy Model",
	description: "A dummy model for testing purposes",
	logoUrl: undefined,
	promptExamples: [
		{ title: "Example 1", prompt: "Hello, how are you?" },
		{ title: "Example 2", prompt: "What is the weather today?" },
	],
	preprompt: "",
	multimodal: false,
	unlisted: false,
	hasInferenceAPI: false,
};

export async function GET() {
	try {
		const res = models
			.filter((m) => m.unlisted == false)
			.map((model) => ({
				id: model.id,
				name: model.name,
				websiteUrl: model.websiteUrl ?? "https://huggingface.co",
				modelUrl: model.modelUrl ?? "https://huggingface.co",
				// tokenizer removed in this build
				datasetName: model.datasetName,
				datasetUrl: model.datasetUrl,
				displayName: model.displayName,
				description: model.description ?? "",
				logoUrl: model.logoUrl,
				promptExamples: model.promptExamples ?? [],
				preprompt: model.preprompt ?? "",
				multimodal: model.multimodal ?? false,
				unlisted: model.unlisted ?? false,
				hasInferenceAPI: model.hasInferenceAPI ?? false,
			}));
		return Response.json(res);
	} catch (e) {
		// Return dummy model if models fail to load
		return Response.json([dummyModel]);
	}
}
