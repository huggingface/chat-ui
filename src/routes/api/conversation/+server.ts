import { HF_TOKEN } from '$env/static/private';
import { PUBLIC_MODEL_ENDPOINT } from '$env/static/public';

export async function POST({ request }) {
	return await fetch(PUBLIC_MODEL_ENDPOINT, {
		headers: {
			...request.headers,
			'Content-Type': 'application/json',
			Authorization: `Basic ${HF_TOKEN}`
		},
		method: 'POST',
		body: await request.text()
	});
}
