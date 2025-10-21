import { defaultModel } from "$lib/server/models";
import type { Timestamps } from "./Timestamps";
import type { User } from "./User";

/**
 * Per-model parameter overrides (Tier 1: most commonly customized)
 */
export interface ModelParameterOverrides {
	temperature?: number;
	max_tokens?: number;
}

export interface Settings extends Timestamps {
	userId?: User["_id"];
	sessionId?: string;

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

	/**
	 * Per-model parameter customization (temperature, max_tokens, etc.)
	 * Empty/undefined values fall back to model defaults.
	 */
	modelParameters?: Record<string, ModelParameterOverrides>;

	disableStream: boolean;
	directPaste: boolean;
}

export type SettingsEditable = Omit<Settings, "welcomeModalSeenAt" | "createdAt" | "updatedAt">;
// TODO: move this to a constant file along with other constants
export const DEFAULT_SETTINGS = {
	shareConversationsWithModelAuthors: true,
	activeModel: defaultModel.id,
	customPrompts: {},
	multimodalOverrides: {},
	hidePromptExamples: {},
	modelParameters: {},
	disableStream: false,
	directPaste: false,
} satisfies SettingsEditable;
