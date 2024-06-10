import type { RequestHandler } from "@sveltejs/kit";
import { COORDINATOR_URL } from "$env/static/private";

export const GET: RequestHandler = async () => {
	try {
		const coordinatorURL = COORDINATOR_URL;
		console.log("coordinatorURL", coordinatorURL);
		const response = await fetch(`${coordinatorURL}/commands`, {
			method: "GET",
			headers: {
				"Content-Type": "application/json",
			},
		});
		if (!response.ok) throw new Error(response.statusText, response.status);
		const json_data = await response.json();
		console.log("json_data", json_data);
		return new Response(JSON.stringify(json_data), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	} catch (error) {
		return new Response(JSON.stringify({ error: error as Error }), {
			status: 500,
			headers: { "Content-Type": "application/json" },
		});
	}
};
