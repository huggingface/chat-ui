import { building } from "$app/environment";
import type { Handle, HandleServerError, ServerInit, HandleFetch } from "@sveltejs/kit";

export const init: ServerInit = async () => {
	if (building) return;
	const mod = await import("$lib/server/hooks/init");
	return mod.initServer();
};

export const handle: Handle = async (input) => {
	if (building) return input.resolve(input.event);
	const mod = await import("$lib/server/hooks/handle");
	return mod.handleRequest(input);
};

export const handleError: HandleServerError = async (input) => {
	if (building) throw input.error;
	const mod = await import("$lib/server/hooks/error");
	return mod.handleServerError(input);
};

export const handleFetch: HandleFetch = async (input) => {
	if (building) return input.fetch(input.request);
	const mod = await import("$lib/server/hooks/fetch");
	return mod.handleFetchRequest(input);
};
