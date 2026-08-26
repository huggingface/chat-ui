/**
 * Slow second-line retries for router 429s, shared by the main tool loop and
 * the research sub-agent's nested loop. The OpenAI SDK's own quick retries run
 * first; these absorb the limits that outlast them, because a turn that has
 * already spent ten productive rounds must not die on one throttled request.
 */
export const RATE_LIMIT_BACKOFF_MS: readonly number[] = [10_000, 25_000, 60_000];

export const isRateLimitError = (err: unknown): boolean =>
	(typeof err === "object" && err !== null && (err as { status?: number }).status === 429) ||
	/\b429\b/.test(String(err));

export const abortableSleep = (ms: number, signal?: AbortSignal): Promise<void> =>
	new Promise((resolve, reject) => {
		const finish = (err?: Error) => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
			err ? reject(err) : resolve();
		};
		const onAbort = () => finish(new Error("Aborted by user"));
		const timer = setTimeout(() => finish(), ms);
		signal?.addEventListener("abort", onAbort, { once: true });
		if (signal?.aborted) onAbort();
	});

/**
 * Run `fn`, absorbing rate limits with backoff. Anything else — and a 429 that
 * outlasts the whole schedule — is rethrown for the caller's error path.
 */
export async function withRateLimitRetry<T>(
	fn: () => Promise<T>,
	opts: { signal?: AbortSignal; onBackoff?: (attempt: number, delayMs: number) => void } = {}
): Promise<T> {
	for (let attempt = 0; ; attempt += 1) {
		try {
			return await fn();
		} catch (err) {
			if (!isRateLimitError(err) || attempt >= RATE_LIMIT_BACKOFF_MS.length) throw err;
			const delayMs = RATE_LIMIT_BACKOFF_MS[attempt];
			opts.onBackoff?.(attempt + 1, delayMs);
			await abortableSleep(delayMs, opts.signal);
		}
	}
}
