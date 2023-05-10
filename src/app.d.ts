/// <reference types="@sveltejs/kit" />
/// <reference types="unplugin-icons/types/svelte" />

import type { ObjectId } from "mongodb";

// See https://kit.svelte.dev/docs/types#app
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			sessionId: string;
			userId?: ObjectId;
		}
		// interface PageData {}
		// interface Platform {}
	}
}

export {};
