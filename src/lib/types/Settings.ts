import type { Timestamps } from "./Timestamps";

export interface Settings extends Timestamps {
	sessionId: string;

	/**
	 * Note: Only conversations with this settings explictly set to true should be shared.
	 *
	 * This setting is explicitly set to true when users accept the ethics modal.
	 * */
	shareConversationsWithModelAuthors: boolean;
	ethicsModalAcceptedAt: Date | null;
}
