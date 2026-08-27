/** Lifecycle of a single step in an ML Assistant plan. */
export type MlPlanStepStatus = "pending" | "running" | "done" | "skipped";

export interface MlPlanStep {
	/** One or two words naming the step, e.g. "Baseline eval". Used as the dot's accessible name. */
	label: string;
	/** Present-tense label shown beside the dots while this step runs, e.g. "Evaluating". */
	statusLabel: string;
	/** One-line explanation shown in the dot's tooltip. */
	description: string;
	status: MlPlanStepStatus;
}
