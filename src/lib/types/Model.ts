export interface Model {
	name: string;
	displayName?: string;
	description?: string;
	websiteUrl?: string;
	datasetName?: string;
	promptExamples?: Array<{ title: string; prompt: string }>;
}
