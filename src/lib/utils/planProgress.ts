import type { PlanStep } from "$lib/types/Plan";
import type { MlPlanStep, MlPlanStepStatus } from "$lib/types/MlAssistant";

const STATUS_MAP: Record<PlanStep["status"], MlPlanStepStatus> = {
	pending: "pending",
	in_progress: "running",
	completed: "done",
	skipped: "skipped",
};

const MAX_LABEL_CHARS = 24;
const MAX_LABEL_WORDS = 3;

/**
 * A dot-sized name derived from the step text. The plan schema carries one
 * string per step, so the strip's short labels are cut from it here; if the
 * tool ever grows a model-authored label field, it supersedes this.
 */
function shortLabel(step: string): string {
	const words = step.split(/\s+/).slice(0, MAX_LABEL_WORDS).join(" ");
	const label = words.length > MAX_LABEL_CHARS ? `${words.slice(0, MAX_LABEL_CHARS - 1)}…` : words;
	return label === step ? label : label.endsWith("…") ? label : `${label}…`;
}

/** update_plan steps in the shape the ML Assistant progress strip renders. */
export function planStepsToMlSteps(steps: PlanStep[]): MlPlanStep[] {
	return steps.map((step) => ({
		label: shortLabel(step.step),
		statusLabel: shortLabel(step.step),
		description: step.step,
		status: STATUS_MAP[step.status],
	}));
}
