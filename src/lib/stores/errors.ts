import { writable } from "svelte/store";

export const ERROR_MESSAGES = {
	default: "Oops, something went wrong.",
	authOnly: "You have to be logged in.",
	rateLimited: "You are sending too many messages. Try again later.",
	securityBlocked: "Request blocked by security policy",
	securityApiError: "Security validation failed",
	upstreamError: "Upstream service error",
	badRequest: "Invalid request",
	internalError: "Internal server error",
};

export const error = writable<string | undefined>(undefined);
