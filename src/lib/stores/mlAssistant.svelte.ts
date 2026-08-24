import type { MlPlanStep, MlPlanStepStatus } from "$lib/types/MlAssistant";

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

	/** Conversation the state above belongs to, so a different one starts clean. */
	#conversationKey: string | undefined;

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
	 * Undoes `startTask` when the send it was latched for never produced a
	 * conversation. Without this a failed create leaves the composer locked in a
	 * task that does not exist, with no way to switch the mode back off.
	 */
	abortTask() {
		this.taskStarted = false;
		this.steps = [];
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
		// Adoption is only for the conversation the run just created, which arrives
		// already marked. Without that check, opening any conversation while a
		// create is pending would inherit the mode the server knows nothing about.
		const adopting =
			this.#conversationKey === undefined &&
			key !== undefined &&
			this.taskStarted &&
			isMlConversation;
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
