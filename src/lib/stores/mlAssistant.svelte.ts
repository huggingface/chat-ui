import { browser } from "$app/environment";
import type { MlPlanStep, MlPlanStepStatus } from "$lib/types/MlAssistant";
import type { ReasoningEffort } from "$lib/types/Settings";

/** A reasoning-effort override the preset replaced, and the value to put back. */
export interface MlEffortHold {
	modelId: string;
	previous?: ReasoningEffort;
}

const EFFORT_HOLD_KEY = "mlAssistantEffortHold";

/**
 * UI state for ML Assistant mode (see `$lib/utils/mlAssistantFlag`).
 *
 * The mode is a property of the conversation: it can be toggled freely until the
 * first message goes out, and is locked for the rest of the conversation after
 * that. Plan steps are pushed in by whatever drives the run — nothing here
 * invents or advances them, so with no plan source the strip stays on its tool
 * note and the progress row never appears.
 */
class MlAssistantStore {
	/** Preset toggle. Editable until `taskStarted`. */
	enabled = $state(false);
	/** Latched by `startTask()` on the send that begins an ML run. */
	taskStarted = $state(false);
	/** The plan as reported by the run. Empty until a plan arrives. */
	steps = $state<MlPlanStep[]>([]);

	#effortHold = $state<MlEffortHold | null>(null);

	/** Conversation the state above belongs to, so a different one starts clean. */
	#conversationKey: string | undefined;

	/**
	 * Reasoning-effort override the preset is holding, with the value to put back.
	 * Lives here rather than in the composer so it survives the navigation from the
	 * home composer into the conversation the send creates, and is mirrored into
	 * sessionStorage so a reload — which drops the mode but not the override — can
	 * still hand the user their setting back (see `restoreEffortHold`).
	 */
	get effortHold() {
		return this.#effortHold;
	}

	set effortHold(hold: MlEffortHold | null) {
		this.#effortHold = hold;
		if (!browser) return;
		if (hold) {
			sessionStorage.setItem(EFFORT_HOLD_KEY, JSON.stringify(hold));
		} else {
			sessionStorage.removeItem(EFFORT_HOLD_KEY);
		}
	}

	/**
	 * Picks up a hold left by an earlier page load. The mode is client state and
	 * does not survive a reload, so whatever it was holding has to be released by
	 * the next load instead.
	 */
	restoreEffortHold(): MlEffortHold | null {
		if (!browser || this.#effortHold) return this.#effortHold;
		const raw = sessionStorage.getItem(EFFORT_HOLD_KEY);
		if (!raw) return null;
		try {
			const hold = JSON.parse(raw) as MlEffortHold;
			if (typeof hold?.modelId === "string") {
				this.#effortHold = hold;
			}
		} catch {
			sessionStorage.removeItem(EFFORT_HOLD_KEY);
		}
		return this.#effortHold;
	}

	/** The switch stops being interactive once the mode is locked in. */
	get locked() {
		return this.taskStarted;
	}

	/** Index of the running step, `-1` before the first one starts. */
	get activeStep() {
		return this.steps.findIndex((step) => step.status === "running");
	}

	get complete() {
		return (
			this.steps.length > 0 &&
			this.steps.every((step) => step.status === "done" || step.status === "skipped")
		);
	}

	/** 1-3 words naming what the plan is doing right now, shown beside the dots. */
	get statusLabel() {
		if (this.complete) return "Done";
		return this.steps.find((step) => step.status === "running")?.statusLabel ?? "";
	}

	toggle(next = !this.enabled) {
		if (this.locked) return;
		this.enabled = next;
	}

	/** Called on the send that starts an ML task. No-op unless the mode is on. */
	startTask() {
		if (!this.enabled) return;
		this.taskStarted = true;
	}

	/**
	 * Seam for the backend: replaces the plan wholesale. Steps arrive with their
	 * own statuses so a resumed conversation renders mid-plan correctly.
	 */
	setPlan(steps: MlPlanStep[]) {
		this.steps = steps;
	}

	/** Seam for the backend: advances a single step as its status streams in. */
	setStepStatus(index: number, status: MlPlanStepStatus) {
		const step = this.steps[index];
		if (!step) return;
		this.steps[index] = { ...step, status };
	}

	reset() {
		this.enabled = false;
		this.taskStarted = false;
		this.steps = [];
	}

	/**
	 * Binds the state to a conversation, dropping it when that conversation
	 * changes. Idempotent, so it is safe to call from an effect on every render.
	 *
	 * A run started from the home composer has no conversation yet, so it adopts
	 * the first id it lands on instead of resetting — otherwise the send that
	 * creates the conversation would immediately throw the mode away.
	 *
	 * @param isMlConversation whether the conversation being opened was started in
	 * the mode (persisted on the conversation, so reopening one restores it).
	 * @returns whether the state was reset, so the caller can release anything
	 * it was holding on the mode's behalf.
	 */
	syncConversation(key: string | undefined, isMlConversation = false): boolean {
		if (this.#conversationKey === key) return false;
		const adopting = this.#conversationKey === undefined && key !== undefined && this.taskStarted;
		this.#conversationKey = key;
		if (adopting) return false;
		this.reset();
		if (isMlConversation) {
			// Already past its first send, so the mode comes back locked on.
			this.enabled = true;
			this.taskStarted = true;
		}
		return true;
	}
}

export const mlAssistant = new MlAssistantStore();
