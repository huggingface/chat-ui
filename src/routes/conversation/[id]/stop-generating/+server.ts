import { AbortRegistry } from "$lib/server/abortRegistry";

/**
 * Ideally, we'd be able to detect the client-side abort, see https://github.com/huggingface/chat-ui/pull/88#issuecomment-1523173850
 */
export async function POST({ params }: { params: { id: string } }) {
	// Abort generation - conversation is stored client-side
	AbortRegistry.getInstance().abort(params.id);

	return new Response();
}
