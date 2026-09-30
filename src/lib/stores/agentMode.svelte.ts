/**
 * Agent modes other than ML Assistant (which keeps its own store). Two separate facts:
 *
 * - `pending`: the mode the next new conversation starts in, set by the `?mode=paperpage-intern`
 *   link and cleared from the composer or once that conversation exists. It survives trips to
 *   other pages (settings, to pick a model) until then.
 * - `current`: the stored mode of the conversation on screen, synced by ChatWindow.
 *
 * `preferredModel` is the model the link preselects: shown and used instead of the saved default
 * while `over` is still the saved default, so any model the user picks wins, and never saved.
 */
export type AgentMode = "paperpage";

class AgentModeStore {
	pending = $state<AgentMode | null>(null);
	current = $state<AgentMode | null>(null);
	preferredModel = $state<{ id: string; over: string } | null>(null);

	/** the preselected model while it still applies, else the saved one */
	modelFor(saved: string): string {
		const preferred = this.pending ? this.preferredModel : null;
		return preferred && preferred.over === saved ? preferred.id : saved;
	}

	/** the pending mode was used or dismissed */
	clearPending() {
		this.pending = null;
		this.preferredModel = null;
	}
}

export const agentMode = new AgentModeStore();
