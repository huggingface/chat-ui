import type { ConvSidebar } from "./ConvSidebar";

export interface ConvGroupSidebar {
	id: string;
	name: string;
	isCollapsed: boolean;
	conversations: ConvSidebar[];
	updatedAt: Date;
}
