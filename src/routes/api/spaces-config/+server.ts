import { Client } from "@gradio/client";

export async function GET({ url }) {
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
