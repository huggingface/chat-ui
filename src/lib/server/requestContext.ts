import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

export interface RequestContext {
	requestId: string;
}

const asyncLocalStorage = new AsyncLocalStorage<RequestContext>();

/**
 * Run a function within a request context.
 * All logs within this context will automatically include the requestId.
 */
export function runWithRequestContext<T>(fn: () => T, requestId?: string): T {
	const context: RequestContext = {
		requestId: requestId ?? randomUUID(),
	};
	return asyncLocalStorage.run(context, fn);
}

/**
 * Get the current request context, if any.
 */
export function getRequestContext(): RequestContext | undefined {
	return asyncLocalStorage.getStore();
}

/**
 * Get the current request ID, or undefined if not in a request context.
 */
export function getRequestId(): string | undefined {
	return asyncLocalStorage.getStore()?.requestId;
}
