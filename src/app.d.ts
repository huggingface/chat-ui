/// <reference types="@sveltejs/kit" />
/// <reference types="unplugin-icons/types/svelte" />

import type { User } from "$lib/types/User";

// See https://kit.svelte.dev/docs/types#app
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			sessionId: string;
			user?: User;
			isAdmin: boolean;
			token?: string;
			/** Organization to bill inference requests to (from settings) */
			billingOrganization?: string;
		}

		interface Error {
			message: string;
			errorId?: ReturnType<typeof crypto.randomUUID>;
		}
		// interface PageData {}
		// interface Platform {}
		interface PageState {
			/** First message text carried from the home/model page to a new conversation. */
			pendingMessage?: string;
			/** Nonce for looking up File[] in the client-side pendingFiles Map. */
			pendingFilesNonce?: string;
			/** Open the voice mode overlay after navigating to a fresh conversation. */
			pendingVoiceMode?: boolean;
		}
	}
}

export {};
