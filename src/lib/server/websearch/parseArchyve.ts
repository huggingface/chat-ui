import { ARCHYVE_API_KEY } from "$env/static/private";
import { ARCHYVE_CLIENT_ID } from "$env/static/private";

export async function parseArchyve(url: string) {
	const abortController = new AbortController();
	setTimeout(() => abortController.abort(), 10000);

	// if we get an archyve link, just call the api and return the right attribute
	const jsonResponse = await fetch(url, {
		headers: {
			Authorization: `Bearer ${ARCHYVE_API_KEY}`,
			"X-Client-Id": ARCHYVE_CLIENT_ID,
			Accept: "application/json",
		},
		signal: abortController.signal,
	})
		.then((response) => response.json() as Promise<{ content: string }>)
		.catch((error) => {
			console.error("Failed to fetch or parse JSON", error);
			throw new Error("Failed to fetch or parse JSON");
		});

	return jsonResponse.content;
}
