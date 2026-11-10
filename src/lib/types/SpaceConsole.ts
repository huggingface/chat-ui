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
	/** the check_space call whose update loaded the frame */
	checkId?: string;
	state: SpaceFrameState;
	/** the page load that acked */
	sessionId?: string;
	gradioVersion?: string;
	/** entries the frame evicted unsent during this load */
	dropped?: number;
	updatedAt: Date;
}
