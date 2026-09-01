import type { RouterExample } from "./routerExamples";

/**
 * Copy and preset data for ML Assistant mode. The tool list mirrors what the
 * preset loads; once the backend serves the preset it should replace this.
 */

/** Tool ids shown in the strip until the run reports a plan. */
export const ML_ASSISTANT_TOOLS = ["papers", "training", "spaces", "datasets", "eval", "hub"];

/** Composer placeholder while the mode is on. */
export const ML_ASSISTANT_PLACEHOLDER = "Describe the ML task — paper URL, model id, or dataset";

/** Reasoning effort the preset runs at. */
export const ML_ASSISTANT_EFFORT = "high" as const;

/**
 * Completion-token floor for the preset. Catalog max_tokens values are sized
 * for chat answers; a high-effort reasoning turn regularly outruns them and
 * gets cut mid-think, costing a retry round or an interrupted turn. A floor,
 * not an override — a catalog value above it wins. Providers that cap lower
 * clamp it themselves.
 */
export const ML_ASSISTANT_MIN_COMPLETION_TOKENS = 32_768;

/** Suggestion chips that replace the default set while the mode is on. */
export const mlAssistantExamples: RouterExample[] = [
	{
		title: "Reproduce a paper",
		prompt: "Reproduce the results of this paper and report where they diverge:",
	},
	{
		title: "Finetune a model",
		prompt: "Finetune a small open model on this dataset and evaluate the checkpoint.",
	},
	{
		title: "Build a demo",
		prompt: "Build a Gradio demo Space for this model.",
	},
	{
		title: "Generate a dataset",
		prompt: "Generate a synthetic dataset for this task and push it to the Hub.",
	},
	{
		title: "Run an eval",
		prompt: "Run an evaluation of this model against a held-out split and score it.",
	},
];
