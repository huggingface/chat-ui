export interface Model {
	name: string;
	displayName?: string;
	websiteUrl?: string;
	datasetName?: string;
	promptExamples?: Array<{ title: string; prompt: string }>;
}
