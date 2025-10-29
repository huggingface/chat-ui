import { json, type RequestEvent } from "@sveltejs/kit";
import buildWebSearchQuery from "$lib/tools/webSearch";

export async function POST({ request }: RequestEvent) {
	const body = await request.json().catch(() => ({}));
	const messages = Array.isArray(body?.messages) ? body.messages : [];
	const q = buildWebSearchQuery(messages);
	return json({ query: q });
}
