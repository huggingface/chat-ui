import type { ConvSidebar } from "./ConvSidebar";

export interface ConvSearchResult extends ConvSidebar {
	description?: string;
	matchedText?: string;
}
