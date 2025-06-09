import type { ObjectId } from "bson";

export interface ConvSidebar {
	id: ObjectId | string;
	title: string;
	updatedAt: Date;
	model?: string;
	assistantId?: ObjectId | string;
	avatarUrl?: string | Promise<string | undefined>;
}
