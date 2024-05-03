// Shouldn't be needed if we dove into sveltekit internals, see https://github.com/huggingface/chat-ui/pull/88#issuecomment-1523173850

import { logger } from "$lib/server/logger";
import { collections } from "$lib/server/database";

export class AbortedGenerations {
	private static instance: AbortedGenerations;

	private abortedGenerations: Map<string, Date> = new Map();

	private constructor() {
		const interval = setInterval(this.updateList, 1000);

		process.on("SIGINT", () => {
			clearInterval(interval);
		});
	}

	public static getInstance(): AbortedGenerations {
		if (!AbortedGenerations.instance) {
			AbortedGenerations.instance = new AbortedGenerations();
		}

		return AbortedGenerations.instance;
	}

	public getList(): Map<string, Date> {
		return this.abortedGenerations;
	}

	private async updateList() {
		try {
			const aborts = await collections.abortedGenerations.find({}).sort({ createdAt: 1 }).toArray();

			this.abortedGenerations = new Map(
				aborts.map(({ conversationId, createdAt }) => [conversationId.toString(), createdAt])
			);
		} catch (err) {
			logger.error(err);
		}
	}
}
