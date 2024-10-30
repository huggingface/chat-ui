import { defaultModel } from "$lib/server/models";
import type { Assistant } from "./Assistant";
import type { Timestamps } from "./Timestamps";
import type { User } from "./User";

export interface Settings extends Timestamps {
	userId?: User["_id"];
	sessionId?: string;

	/**
	 * Note: Only conversations with this settings explicitly set to true should be shared.
	 *
	 * This setting is explicitly set to true when users accept the ethics modal.
	 * */
	shareConversationsWithModelAuthors: boolean;
	ethicsModalAcceptedAt: Date | null;
	activeModel: string;
	hideEmojiOnSidebar?: boolean;

	// model name and system prompts
	customPrompts?: Record<string, string>;

	assistants?: Assistant["_id"][];
	tools?: string[];
	disableStream: boolean;
	directPaste: boolean;
}

export type SettingsEditable = Omit<Settings, "ethicsModalAcceptedAt" | "createdAt" | "updatedAt">;
// TODO: move this to a constant file along with other constants
export const DEFAULT_SETTINGS = {
	shareConversationsWithModelAuthors: true,
	activeModel: defaultModel.id,
	hideEmojiOnSidebar: false,
	customPrompts: {},
	assistants: [],
	tools: [],
	disableStream: false,
	directPaste: false,
} satisfies SettingsEditable;
