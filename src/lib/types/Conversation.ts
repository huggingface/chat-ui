import type { ObjectId } from "mongodb";
import type { Message } from "./Message";
import type { Timestamps } from "./Timestamps";
import type { User } from "./User";
import type { Assistant } from "./Assistant";

export interface Conversation extends Timestamps {
	_id: ObjectId;

	sessionId?: string;
	userId?: User["_id"];

	model: string;

	title: string;
	rootMessageId?: Message["id"];
	messages: Message[];

	meta?: {
		fromShareId?: string;
	};

	preprompt?: string;
	assistantId?: Assistant["_id"];

	userAgent?: string;

	/**
	 * Spaces this conversation's artifacts have been deployed to, keyed by the
	 * stable artifact `identifier`. Lets a re-deploy push a new commit to the same
	 * Space instead of creating a new one. Only Spaces created through this app's
	 * OAuth client are reachable (the `contribute-repos` scope), so every entry
	 * here maps to an app-created Space.
	 */
	deployedSpaces?: Record<string, DeployedSpace>;
}

export interface DeployedSpace {
	/** Full repo id, e.g. `username/my-artifact`. */
	repoId: string;
	createdAt: Date;
	/**
	 * Visibility the Space was created with, preserved so a recreate (after the
	 * user deleted the Space on the Hub) doesn't silently flip a private Space to
	 * public — the update modal hides the visibility control.
	 */
	private: boolean;
}
