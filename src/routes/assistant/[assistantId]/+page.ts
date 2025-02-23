import { useEdenFetch } from "$lib/utils/api";
import { error } from "@sveltejs/kit";
import type { Assistant } from "$lib/types/Assistant";
import type { Serialize } from "$lib/utils/serialize";

export async function load({ fetch, params }) {
	const edenFetch = useEdenFetch({ fetch });

	const { data, error: e } = await edenFetch("/assistants/:id", {
		method: "GET",
		params: {
			id: params.assistantId,
		},
	});

	if (e) {
		error(e.status, e.message);
	}

	const { error: subscribeError } = await edenFetch("/assistants/:id/subscribe", {
		method: "POST",
		params: {
			id: params.assistantId,
		},
	});

	if (subscribeError) {
		console.error(subscribeError);
		error(subscribeError.status, subscribeError.message);
	}

	return { assistant: data as Serialize<Assistant> };
}
