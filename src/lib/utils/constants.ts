import { defaultModel } from "./server/models";
import type { SettingsEditable } from "./types/Settings";

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
