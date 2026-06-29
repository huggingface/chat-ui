// Simple type to replace removed WebSearchSource
type SimpleSource = {
	title?: string;
	link: string;
};
import { processBlocks, fallbackBlocks, type BlockToken } from "$lib/utils/marked";

export type IncomingMessage = {
	type: "process";
	content: string;
	sources: SimpleSource[];
	requestId: number;
	streaming?: boolean;
};

export type OutgoingMessage = {
	type: "processed";
	blocks: BlockToken[];
	requestId: number;
};

// Stateless request/response. All flow control (one job at a time per worker, per-client
// coalescing) lives in the shared pool (markdownWorkerPool.ts), so the worker just
// processes whatever it is handed and replies once. The pool never posts a second job to
// a busy worker, hence no internal queue/buffer here.
onmessage = async (event) => {
	const data = event.data as IncomingMessage;
	if (data.type !== "process") {
		return;
	}

	const { content, sources, requestId, streaming } = data;

	let blocks: BlockToken[];
	try {
		blocks = await processBlocks(content, sources ?? [], streaming ?? false);
	} catch {
		// Never strand the pool: it waits for a reply to free this worker, so on failure
		// degrade to the lightweight fallback rendering instead of going silent.
		blocks = fallbackBlocks(content);
	}

	postMessage(
		JSON.parse(JSON.stringify({ type: "processed", blocks, requestId })) as OutgoingMessage
	);
};
