import type { BackendModel } from "$lib/server/models";

export type Model = Pick<
	BackendModel,
	"name" | "displayName" | "websiteUrl" | "datasetName" | "promptExamples" | "parameters"
>;
