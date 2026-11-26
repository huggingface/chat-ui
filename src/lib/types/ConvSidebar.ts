import type { ObjectId } from "bson";
import type { ManagedBy } from "./Conversation";

export interface ConvSidebar {
	id: ObjectId | string;
	title: string;
	updatedAt: Date;
	model?: string;
	avatarUrl?: string | Promise<string | undefined>;
	/** Started in ML Intern mode — the sidebar marks these and shows their turn status. */
	mlAssistant?: boolean;
	managedBy?: ManagedBy;
}
