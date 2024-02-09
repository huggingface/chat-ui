import {
	USE_LOCAL_SEARXNG_URL,
    SEARXNG_CATEGORIES,
	SEARXNG_ENGINES,
} from "$env/static/private";

export async function searchSearxng(query: string) {
    const abortController = new AbortController();
    setTimeout(() => abortController.abort(), 10000);

//Build query URL
let url = `${USE_LOCAL_SEARXNG_URL}/search?q=` +  query;

if (SEARXNG_CATEGORIES) {
    url += `&categories=${SEARXNG_CATEGORIES}`;
}

if (SEARXNG_ENGINES) {
    url += `&engines=${SEARXNG_ENGINES}`;
}

url += "&format=json";

    // Call the URL to return JSON data
    const jsonResponse = await fetch(url, {
        signal: abortController.signal,
    })
    .then((response) => response.json())
    .catch((error) => {
        console.error("Failed to fetch or parse JSON", error);
        throw new Error("Failed to fetch or parse JSON");
    });

    // Extract 'url' elements from the JSON response
    const urls = jsonResponse.results.map(item => item.url);

    if (!urls.length) {
        throw new Error(`Response doesn't contain any "url" elements`);
    }

    // Map URLs to the correct object shape if needed
    return { organic_results: urls.map(link => ({ link })) };
}