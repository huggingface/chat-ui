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
			user?: User & { logoutDisabled?: boolean };
		}

		interface Error {
			message: string;
			errorId?: ReturnType<typeof crypto.randomUUID>;
		}
		// interface PageData {}
		// interface Platform {}
	}

	/**
	 * The BeforeInstallPromptEvent is fired at the Window.onbeforeinstallprompt handler
	 * before a user is prompted to "install" a web site to a home screen on mobile.
	 *
	 * @deprecated Only supported on Chrome and Android Webview.
	 */
	interface BeforeInstallPromptEvent extends Event {
		/**
		 * Returns an array of DOMString items containing the platforms on which the event was dispatched.
		 * This is provided for user agents that want to present a choice of versions to the user such as,
		 * for example, "web" or "play" which would allow the user to chose between a web version or
		 * an Android version.
		 */
		readonly platforms: Array<string>;

		/**
		 * Returns a Promise that resolves to a DOMString containing either "accepted" or "dismissed".
		 */
		readonly userChoice: Promise<{
			outcome: "accepted" | "dismissed";
			platform: string;
		}>;

		/**
		 * Allows a developer to show the install prompt at a time of their own choosing.
		 * This method returns a Promise.
		 */
		prompt(): Promise<void>;
	}
}

export {};
