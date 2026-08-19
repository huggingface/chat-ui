/**
 * Transient completion toasts for background generations. Separate from the error
 * banner (errors.ts), which is a single-slot red banner with no queue or variants.
 *
 * SSR-safe like conversations.svelte.ts: factory plus context helpers, no
 * module-level mutable state. Pushed only in the browser by the live watcher.
 */

import { getContext, setContext } from "svelte";
import type { GenerationStatus } from "$lib/types/Generation";

export const NOTIFICATIONS_CONTEXT_KEY = "notificationsStore";

const AUTO_DISMISS_MS = 8_000;

export interface GenerationNotification {
	id: number;
	conversationId: string;
	title: string;
	status: GenerationStatus;
}

class NotificationsStore {
	#items = $state<GenerationNotification[]>([]);
	#nextId = 0;

	get items(): GenerationNotification[] {
		return this.#items;
	}

	push(notification: Omit<GenerationNotification, "id">): void {
		const id = this.#nextId++;
		this.#items = [...this.#items, { ...notification, id }];
		setTimeout(() => this.dismiss(id), AUTO_DISMISS_MS);
	}

	dismiss(id: number): void {
		this.#items = this.#items.filter((item) => item.id !== id);
	}
}

export function createNotificationsStore(): NotificationsStore {
	const store = new NotificationsStore();
	setContext(NOTIFICATIONS_CONTEXT_KEY, store);
	return store;
}

export function useNotificationsStore(): NotificationsStore {
	return getContext<NotificationsStore>(NOTIFICATIONS_CONTEXT_KEY);
}

export type { NotificationsStore };
