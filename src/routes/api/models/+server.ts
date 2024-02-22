import { models } from "$lib/server/models";

export async function GET() {
	const res = models.map((model) => ({
		id: model.id,
		name: model.name,
		websiteUrl: model.websiteUrl,
		modelUrl: model.modelUrl,
		datasetName: model.datasetName,
		datasetUrl: model.datasetUrl,
		displayName: model.displayName,
		description: model.description,
		logoUrl: model.logoUrl,
		promptExamples: model.promptExamples,
		preprompt: model.preprompt,
		multimodal: model.multimodal,
		unlisted: model.unlisted,
	}));
	return Response.json(res);
}
