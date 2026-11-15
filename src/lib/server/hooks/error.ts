import type { HandleServerError } from "@sveltejs/kit";
import { logger } from "$lib/server/logger";

type HandleServerErrorInput = Parameters<HandleServerError>[0];

export async function handleServerError({
	error,
	event,
	status,
	message,
}: HandleServerErrorInput): Promise<App.Error> {
	// handle 404
	if (event.route.id === null) {
		return {
			message: `Page ${event.url.pathname} not found`,
		};
	}

	const errorId = crypto.randomUUID();

	logger.error({
		// Locals and request URLs can contain OAuth tokens and account-link tickets.
		url: event.url.pathname,
		method: event.request.method,
		message,
		error,
		errorId,
		status,
		stack: error instanceof Error ? error.stack : undefined,
	});

	return {
		message: "An error occurred",
		errorId,
	};
}
