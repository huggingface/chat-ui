import { defaultModel } from "$lib/server/models";
import type { Timestamps } from "./Timestamps";
import type { User } from "./User";

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
	 * Per‑model overrides to enable tool calling (OpenAI tools/function calling)
	 * even when not advertised by the provider list. Only `true` is meaningful.
	 */
	toolsOverrides?: Record<string, boolean>;

	/**
	 * Per-model toggle to hide Omni prompt suggestions shown near the composer.
	 * When set to `true`, prompt examples for that model are suppressed.
	 */
	hidePromptExamples?: Record<string, boolean>;

	/**
	 * Per-model inference provider preference.
	 * Values: "auto" (default), "fastest", "cheapest", or a specific provider name (e.g., "together", "sambanova").
	 * The value is appended to the model ID when making inference requests (e.g., "model:fastest").
	 */
	providerOverrides?: Record<string, string>;

	disableStream: boolean;
	directPaste: boolean;

	/**
	 * Organization to bill inference requests to (HuggingChat only).
	 * Stores the org's preferred_username. If empty/undefined, bills to personal account.
	 */
	billingOrganization?: string;
}

export type SettingsEditable = Omit<Settings, "welcomeModalSeenAt" | "createdAt" | "updatedAt">;
// TODO: move this to a constant file along with other constants
export const DEFAULT_SETTINGS = {
	shareConversationsWithModelAuthors: true,
	activeModel: defaultModel.id,
	customPrompts: {},
	multimodalOverrides: {},
	toolsOverrides: {},
	hidePromptExamples: {},
	providerOverrides: {},
	disableStream: false,
	directPaste: false,
} satisfies SettingsEditable;
