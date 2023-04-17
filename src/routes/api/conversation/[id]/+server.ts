export async function GET({ params }) {
	const module = await import('../../../../data/conversation_1.json');
	const conversation = JSON.stringify(module.default);

	return new Response(conversation);
}
