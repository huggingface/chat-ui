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
 * Fallback dot name cut from the step text, for plans persisted before the
 * schema grew its model-authored `label` (or the odd update that omits one).
 */
function shortLabel(step: string): string {
	const words = step.split(/\s+/).slice(0, MAX_LABEL_WORDS).join(" ");
	const label = words.length > MAX_LABEL_CHARS ? `${words.slice(0, MAX_LABEL_CHARS - 1)}…` : words;
	return label === step ? label : label.endsWith("…") ? label : `${label}…`;
}

/** update_plan steps in the shape the ML Assistant progress strip renders. */
export function planStepsToMlSteps(steps: PlanStep[]): MlPlanStep[] {
	return steps.map((step) => {
		const label = step.label ?? shortLabel(step.step);
		return {
			label,
			statusLabel: label,
			description: step.step,
			status: STATUS_MAP[step.status],
		};
	});
}
