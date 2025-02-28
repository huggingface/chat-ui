import { error } from "@sveltejs/kit";
import type { Assistant } from "$lib/types/Assistant";
import type { Serialize } from "$lib/utils/serialize";
import { base } from "$app/paths";

export async function load({ fetch, params }) {
	const r = await fetch(`${base}/api/v2/assistants/${params.assistantId}`);

	if (!r.ok) {
		error(r.status, r.statusText);
	}

	const data = await r.json();

	const r2 = await fetch(`${base}/api/v2/assistants/${params.assistantId}/subscribe`, {
		method: "POST",
	});

	if (!r2.ok) {
		error(r2.status, r2.statusText);
	}

	return { assistant: data as Serialize<Assistant> };
}
