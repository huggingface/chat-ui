import { HF_TOKEN } from '$env/static/private';
import { PUBLIC_MODEL_ENDPOINT } from '$env/static/public';

export async function POST({ request, fetch }) {
	const resp = await fetch(PUBLIC_MODEL_ENDPOINT, {
		headers: {
			'Content-Type': request.headers.get('Content-Type') ?? 'application/json',
			Authorization: `Basic ${HF_TOKEN}`
		},
		method: 'POST',
		body: await request.text()
	});

	return new Response(resp.body, {
		headers: Object.fromEntries(resp.headers.entries()),
		status: resp.status,
		statusText: resp.statusText
	});
}
