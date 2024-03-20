import { ARCHYVE_API_KEY } from "$env/static/private";
import { ARCHYVE_QUERY_URL } from "$env/static/private";

export async function searchArchyve(query: string) {
	const abortController = new AbortController();
	setTimeout(() => abortController.abort(), 10000);

	// insert the query into the URL template
	const url = ARCHYVE_QUERY_URL.replace("<query>", query);

	// search Archyve for relevant documents
	const jsonResponse = await fetch(url, {
		headers: {
			Authorization: `Bearer ${ARCHYVE_API_KEY}`,
			Accept: "application/json",
		},
		signal: abortController.signal,
	})
		.then((response) => response.json() as Promise<{ hits: { text: string; distance: number }[] }>)
		.catch((error) => {
			console.error("Failed to fetch or parse JSON", error);
			throw new Error("Failed to fetch or parse JSON");
		});

	// get 'hits' from the response
	const hits = jsonResponse.hits.slice(0, 5);

	if (!hits.length) {
		throw new Error(`Response doesn't contain any "hit" elements`);
	}

	return { organic_results: hits };
}
