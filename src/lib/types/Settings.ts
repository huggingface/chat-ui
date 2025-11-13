import type { Timestamps } from "./Timestamps";

export interface Settings extends Timestamps {
	id?: string;

	shareConversationsWithModelAuthors: boolean;
	/** One-time welcome modal acknowledgement */
	welcomeModalSeenAt?: Date | null;
	activeModel: string;

	// model name and system prompts
	customPrompts?: Record<string, string>;

	/**
	 * Per‑model overrides to enable multimodal (image) support
	 * even when not advertised by the provider/model list.
	 * Only the `true` value is meaningful (enables images).
	 */
	multimodalOverrides?: Record<string, boolean>;

	/**
	 * Per-model toggle to hide Omni prompt suggestions shown near the composer.
	 * When set to `true`, prompt examples for that model are suppressed.
	 */
	hidePromptExamples?: Record<string, boolean>;

	disableStream: boolean;
	directPaste: boolean;

	// Security API settings
	securityApiEnabled?: boolean;
	securityApiUrl?: string;
	securityApiKey?: string;

	// LLM API override settings
	llmApiUrl?: string;
	llmApiKey?: string;
}

export type SettingsEditable = Omit<Settings, "welcomeModalSeenAt" | "createdAt" | "updatedAt">;
// TODO: move this to a constant file along with other constants
// Note: activeModel is set to empty string - should be populated from models list on client side
export const DEFAULT_SETTINGS = {
	shareConversationsWithModelAuthors: true,
	activeModel: "", // Will be set from models list on client side
	customPrompts: {},
	multimodalOverrides: {},
	hidePromptExamples: {},
	disableStream: false,
	directPaste: false,
	securityApiEnabled: false,
	securityApiUrl: "",
	securityApiKey: "",
	llmApiUrl: "",
	llmApiKey: "",
} satisfies SettingsEditable;
