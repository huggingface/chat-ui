import type { Conversation } from "./Conversation";
import type { Timestamps } from "./Timestamps";

/**
 * the ml-intern-session label value and the reconcile schedule of a conversation
 * its own collection so the poller finds what is due without scanning conversations
 */
export interface MlSessionLabel extends Timestamps {
	/** the conversation id */
	_id: Conversation["_id"];
	/** random so an org member reading the org job list learns nothing */
	value: string;
	/** where labelled submissions went, the namespaces a reconcile lists */
	namespaces?: string[];
	/** bumped by every labelled submission, a reconcile claimed before one leaves the next one due */
	submissions?: number;
	/** when the next reconcile is due, absent once every submission has been listed back */
	reconcileAt?: Date;
	/** past this no submission could still be running, a reconcile that keeps failing stops */
	reconcileUntil?: Date;
	reconciledAt?: Date;
}
