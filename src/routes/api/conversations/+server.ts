export async function GET({ request }) {
	const module = await import('../../../data/conversations.json');
	const conversations = JSON.stringify(module.default);

	return new Response(conversations);
}

export async function POST({ request }) {
	const response = {
		id: crypto.randomUUID(),
		created_at: new Date().toISOString(),
		title: null
	};
	return new Response(JSON.stringify(response));
}
