import type { ObjectId } from "bson";

export interface ConvSidebar {
	id: ObjectId | string;
	title: string;
	updatedAt: Date;
	model?: string;
	avatarUrl?: string | Promise<string | undefined>;
	/** Started in ML Intern mode — the sidebar marks these and shows their turn status. */
	mlAssistant?: boolean;
}
