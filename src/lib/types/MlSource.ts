import type { ObjectId } from "mongodb";
import type { Conversation } from "./Conversation";

export type MlSourceKind = "paper" | "docs" | "hub" | "github" | "web";

/** the main agent, the other readers are sub-agent runs named by their mlAgentRuns id */
export const PARENT_READER = "parent";

/**
 * a page or file a research or web tool read, or a url that only came back in search results
 * links only, what the page said is never stored
 */
export interface MlSource {
	_id: ObjectId;
	conversationId: Conversation["_id"];
	/** http or https, unique per conversation, what the pane links to */
	url: string;
	/** the host for the web, a label for papers and docs, owner/name for hub and github files */
	group: string;
	title?: string;
	kind: MlSourceKind;
	/** false while the url only came back in search results, a later read flips it and nothing flips it back */
	opened: boolean;
	/** PARENT_READER or an mlAgentRuns id, each once, everyone it came back to */
	readBy: string[];
	/** the readers in readBy that opened it, a search hit leaves a reader out */
	openedBy: string[];
	firstSeenAt: Date;
	lastSeenAt: Date;
	/** every call that returned it, reads and search results alike */
	count: number;
}
