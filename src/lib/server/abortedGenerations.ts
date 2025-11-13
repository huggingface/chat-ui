// Shouldn't be needed if we dove into sveltekit internals, see https://github.com/huggingface/chat-ui/pull/88#issuecomment-1523173850

export class AbortedGenerations {
	private static instance: AbortedGenerations;

	private abortedGenerations: Record<string, Date> = {};

	private constructor() {
		// Memory-based abort tracking - MongoDB removed
		// Aborts are tracked in memory only
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

	public setAbortTime(conversationId: string, date: Date) {
		this.abortedGenerations[conversationId] = date;
	}
}
