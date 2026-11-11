import type { ObjectId } from "mongodb";

/** where the space pane handshake with its frame stands */
export type SpaceFrameState = "loading" | "connected" | "unsupported";

/** one browser console entry a framed space forwarded */
export interface SpaceConsoleEntry {
	_id: ObjectId;
	conversationId: ObjectId;
	spaceId: string;
	/** the frame page load */
	sessionId: string;
	seq: number;
	/** capture time in the frame, ms since epoch */
	ts: number;
	level: string;
	text: string;
	stack?: string;
	createdAt: Date;
}

/** the latest frame the user tab loaded for a space */
export interface SpaceConsoleFrame {
	_id: ObjectId;
	conversationId: ObjectId;
	spaceId: string;
	/** one per frame load, so a late message from an earlier load cannot overwrite this one */
	loadId: string;
	/** the check_space call this load was opened for */
	loadedFor?: string;
	/** the latest check_space call this load was asked to answer */
	checkId?: string;
	/** the check_space call the latest snapshot answered */
	answeredCheck?: string;
	state: SpaceFrameState;
	/** the page load that answered */
	sessionId?: string;
	gradioVersion?: string;
	/** total the frame evicted since that page load, as its latest snapshot said */
	dropped?: number;
	updatedAt: Date;
}
