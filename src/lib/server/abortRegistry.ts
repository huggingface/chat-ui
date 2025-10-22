import { logger } from "$lib/server/logger";

const MAX_TRACKED_CONVERSATIONS = 1000;
const MAX_CONTROLLERS_PER_CONVERSATION = 16;

/**
 * Tracks active upstream generation requests so they can be cancelled on demand.
 * Multiple controllers can be registered per conversation (for threaded/background runs).
 */
export class AbortRegistry {
	private static instance: AbortRegistry;

	private controllers = new Map<string, Set<AbortController>>();

	public static getInstance(): AbortRegistry {
		if (!AbortRegistry.instance) {
			AbortRegistry.instance = new AbortRegistry();
		}
		return AbortRegistry.instance;
	}

	public register(conversationId: string, controller: AbortController) {
		const key = conversationId.toString();
		let set = this.controllers.get(key);
		if (!set) {
			set = new Set();
		}
		if (set.size >= MAX_CONTROLLERS_PER_CONVERSATION) {
			const oldestController = set.values().next().value as AbortController | undefined;
			if (oldestController) {
				if (!oldestController.signal.aborted) {
					logger.warn(
						{ conversationId: key },
						"Evicting oldest AbortController after reaching per-conversation limit"
					);
					oldestController.abort();
				}
				set.delete(oldestController);
			}
		}
		set.add(controller);
		// Refresh insertion order for LRU-style eviction
		this.controllers.delete(key);
		this.controllers.set(key, set);
		controller.signal.addEventListener(
			"abort",
			() => {
				this.unregister(key, controller);
			},
			{ once: true }
		);

		if (this.controllers.size > MAX_TRACKED_CONVERSATIONS) {
			const oldestKey = this.controllers.keys().next().value as string | undefined;
			if (oldestKey) {
				const controllers = this.controllers.get(oldestKey);
				if (controllers) {
					logger.warn(
						{ conversationId: oldestKey },
						"Evicting AbortRegistry entry after reaching capacity"
					);
					for (const ctrl of controllers) {
						if (!ctrl.signal.aborted) {
							ctrl.abort();
						}
					}
				}
				this.controllers.delete(oldestKey);
			}
		}
	}

	public abort(conversationId: string) {
		const set = this.controllers.get(conversationId);
		if (!set?.size) return;

		logger.debug({ conversationId }, "Aborting active generation via AbortRegistry");
		for (const controller of set) {
			if (!controller.signal.aborted) {
				controller.abort();
			}
		}
		this.controllers.delete(conversationId);
	}

	public unregister(conversationId: string, controller: AbortController) {
		const set = this.controllers.get(conversationId);
		if (!set) return;
		set.delete(controller);
		if (set.size === 0) {
			this.controllers.delete(conversationId);
		}
	}
}
