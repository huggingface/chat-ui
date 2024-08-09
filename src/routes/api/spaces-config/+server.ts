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

	try {
		const api = await (await Client.connect(space)).view_api();
		return new Response(JSON.stringify(api), {
			status: 200,
			headers: {
				"Content-Type": "application/json",
			},
		});
	} catch (e) {
		return new Response(JSON.stringify({ error: true, message: "Failed to get space API" }), {
			status: 400,
			headers: {
				"Content-Type": "application/json",
			},
		});
	}
}
