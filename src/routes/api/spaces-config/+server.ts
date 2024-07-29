import { Client } from "@gradio/client";

export async function GET({ url, locals }) {
	// XXX: feature_flag_tools
	if (!locals.user?.isEarlyAccess) {
		return new Response("Not early access", { status: 403 });
	}

	const space = url.searchParams.get("space");

	if (!space) {
		return new Response("Missing space", { status: 400 });
	}

	const api = await (await Client.connect(space)).view_api();

	return new Response(JSON.stringify(api), {
		status: 200,
		headers: {
			"Content-Type": "application/json",
		},
	});
}
