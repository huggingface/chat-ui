// Shouldn't be needed if we dove into sveltekit internals, see https://github.com/huggingface/chat-ui/pull/88#issuecomment-1523173850

import { logger } from "$lib/server/logger";
import { collections } from "$lib/server/database";
import { onExit } from "./exitHandler";

export class AbortedGenerations {
	private static instance: AbortedGenerations;

	private abortedGenerations: Record<string, Date> = {};

	private constructor() {
		const interval = setInterval(() => this.updateList(), 1000);
		onExit(() => clearInterval(interval));

		this.updateList();
	}

	public static getInstance(): AbortedGenerations {
		if (!AbortedGenerations.instance) {
			AbortedGenerations.instance = new AbortedGenerations();
		}

		return AbortedGenerations.instance;
	}

	public getAbortTime(conversationId: string): Date | undefined {
		return this.abortedGenerations[conversationId];
	}

	private async updateList() {
		try {
			const aborts = await collections.abortedGenerations.find({}).sort({ createdAt: 1 }).toArray();

			this.abortedGenerations = Object.fromEntries(
				aborts.map((abort) => [abort.conversationId.toString(), abort.createdAt])
			);
		} catch (err) {
			logger.error(err);
		}
	}
}
