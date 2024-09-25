import { models } from "$lib/server/models";

export async function GET() {
	const res = models
		.filter((m) => m.unlisted == false)
		.map((model) => ({
			id: model.id,
			name: model.name,
			websiteUrl: model.websiteUrl ?? "https://huggingface.co",
			modelUrl: model.modelUrl ?? "https://huggingface.co",
			tokenizer: model.tokenizer,
			datasetName: model.datasetName,
			datasetUrl: model.datasetUrl,
			displayName: model.displayName,
			description: model.description ?? "",
			logoUrl: model.logoUrl,
			promptExamples: model.promptExamples ?? [],
			preprompt: model.preprompt ?? "",
			multimodal: model.multimodal ?? false,
			unlisted: model.unlisted ?? false,
			tools: model.tools ?? false,
			hasInferenceAPI: model.hasInferenceAPI ?? false,
		}));
	return Response.json(res);
}
