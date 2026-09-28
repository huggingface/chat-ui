export type PlanStepStatus = "pending" | "in_progress" | "completed" | "skipped";

export interface PlanStep {
	step: string;
	status: PlanStepStatus;
	/**
	 * Model-authored one-or-two-word name for compact progress displays (the ML
	 * Assistant strip's dots and their accessible names). Absent on plans from
	 * before the field existed; consumers fall back to cutting `step`.
	 */
	label?: string;
}

/**
 * The conversation's current plan, maintained by the model through the
 * `update_plan` builtin tool. Stored on the Conversation document rather than
 * derived from message updates so it survives history truncation, regeneration
 * and message-tree branching, and can be re-injected into context each turn.
 */
export interface PlanState {
	/**
	 * Consolidated statement of what the user currently wants, folding in every
	 * requirement and correction so far — not just the step list.
	 */
	goal: string;
	steps: PlanStep[];
	/** Monotonic per conversation; user-edit concurrency will hang off this. */
	version: number;
	updatedAt: Date;
}
