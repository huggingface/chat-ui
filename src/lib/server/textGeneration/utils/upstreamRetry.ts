/**
 * Slow second-line retries for transient router failures, shared by the main
 * tool loop and the research sub-agent's nested loop. The OpenAI SDK's own
 * quick retries run first; these absorb the failures that outlast them,
 * because a turn that has already spent ten productive rounds must not die on
 * one throttled or briefly unavailable request.
 */
import { APIConnectionError } from "openai";

export const RETRY_BACKOFF_MS: readonly number[] = [10_000, 25_000, 60_000];

export const isRateLimitError = (err: unknown): boolean =>
	(typeof err === "object" && err !== null && (err as { status?: number }).status === 429) ||
	/\b429\b/.test(String(err));

/**
 * Retriable because the same request can succeed unchanged moments later: a
 * throttle, a gateway with no backend ready (the router's "503 no available
 * server"), or a connection that never reached it — a DNS blip on the machine
 * running chat-ui surfaces here as APIConnectionError.
 *
 * 500 is deliberately absent. It is the router's answer to a request the
 * upstream model rejected, so it repeats on retry and only costs the schedule.
 */
export const isRetriableUpstreamError = (err: unknown): boolean => {
	if (isRateLimitError(err)) return true;
	if (err instanceof APIConnectionError) return true;
	const status =
		typeof err === "object" && err !== null ? (err as { status?: number }).status : undefined;
	return status === 502 || status === 503 || status === 504;
};

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
 * Run `fn`, absorbing transient upstream failures with backoff. Anything else —
 * and a transient failure that outlasts the whole schedule — is rethrown for
 * the caller's error path.
 */
export async function withUpstreamRetry<T>(
	fn: () => Promise<T>,
	opts: {
		signal?: AbortSignal;
		onBackoff?: (attempt: number, delayMs: number, err: unknown) => void;
	} = {}
): Promise<T> {
	for (let attempt = 0; ; attempt += 1) {
		try {
			return await fn();
		} catch (err) {
			if (!isRetriableUpstreamError(err) || attempt >= RETRY_BACKOFF_MS.length) throw err;
			const delayMs = RETRY_BACKOFF_MS[attempt];
			opts.onBackoff?.(attempt + 1, delayMs, err);
			await abortableSleep(delayMs, opts.signal);
		}
	}
}
