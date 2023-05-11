import { ERROR_MESSAGES, error } from "./stores/errors";

export const authFetch = (...args: Parameters<typeof fetch>) =>
	fetch(...args)
		.then((response) => {
			if (!response.ok && response.status === 401) {
				error.set(ERROR_MESSAGES.authOnly);
			}
			return response;
		})
		.catch((e) => {
			error.set(ERROR_MESSAGES.default);
			throw e;
		});
