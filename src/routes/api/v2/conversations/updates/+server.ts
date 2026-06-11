import type { RequestHandler } from "@sveltejs/kit";
import { requireAuth } from "$lib/server/api/utils/requireAuth";
import { collections } from "$lib/server/database";
import { authCondition } from "$lib/server/auth";
import { isAssistantGenerationTerminal } from "$lib/utils/generationState";
import type { Message } from "$lib/types/Message";

/**
 * SSE endpoint that pushes conversation-update events to the client.
 *
 * The client opens this stream while background generations are in flight.
 * Because generations may complete on any pod, this handler uses a server-side
 * poll loop (every ~2 s) rather than in-process events.
 *
 * Protocol
 * --------
 * Each SSE event has type "update" and a JSON payload:
 *   { id: string, title: string, updatedAt: string (ISO), isTerminal: boolean }
 *
 * The client reconnects automatically (SSE default) after the server closes
 * the stream at MAX_LIFETIME_MS; it should pass the last known cursor via
 * the `?cursor` query parameter to avoid re-sending stale events on reconnect.
 *
 * Multi-instance safety
 * ---------------------
 * We query MongoDB directly on every tick, so updates written by any pod are
 * visible here without in-process coordination.
 */

const POLL_INTERVAL_MS = 2_000;
const MAX_LIFETIME_MS = 5 * 60_000;

type ConvUpdate = {
	id: string;
	title: string;
	updatedAt: string;
	isTerminal: boolean;
};

export const GET: RequestHandler = async ({ locals, url, request }) => {
	requireAuth(locals);

	// `cursor` is an ISO timestamp; events with updatedAt > cursor are sent.
	// On the very first connection the client passes cursor=0 (epoch) so all
	// in-flight conversations are surfaced immediately.
	const cursorParam = url.searchParams.get("cursor");
	let cursor = cursorParam ? new Date(cursorParam) : new Date(0);

	const stream = new ReadableStream({
		async start(controller) {
			const signal = request.signal;
			const deadline = Date.now() + MAX_LIFETIME_MS;

			const encode = (data: ConvUpdate) =>
				new TextEncoder().encode(`event: update\ndata: ${JSON.stringify(data)}\n\n`);

			const sendHeartbeat = () => controller.enqueue(new TextEncoder().encode(": heartbeat\n\n"));

			while (!signal.aborted && Date.now() < deadline) {
				// Wait for next tick (or abort)
				await new Promise<void>((resolve) => {
					const t = setTimeout(resolve, POLL_INTERVAL_MS);
					signal.addEventListener(
						"abort",
						() => {
							clearTimeout(t);
							resolve();
						},
						{ once: true }
					);
				});

				if (signal.aborted) break;

				try {
					// Find conversations belonging to this user that changed since cursor.
					// We project just enough to determine terminal state without loading
					// full message content (only metadata fields on the last assistant message).
					const changed = await collections.conversations
						.find({
							...authCondition(locals),
							updatedAt: { $gt: cursor },
						})
						.project<{
							_id: { toString(): string };
							title: string;
							updatedAt: Date;
							messages: Array<
								Pick<Message, "from" | "interrupted" | "updates"> & { content?: string }
							>;
						}>({
							title: 1,
							updatedAt: 1,
							// Project only the fields isAssistantGenerationTerminal needs.
							// We cannot do a sparse projection of only the last message from
							// MongoDB without an aggregation stage, so we project all messages
							// but limit to the fields we need (not the large content strings).
							"messages.from": 1,
							"messages.interrupted": 1,
							"messages.updates": 1,
						})
						.sort({ updatedAt: -1 })
						.limit(50)
						.toArray();

					for (const conv of changed) {
						if (signal.aborted) break;

						const lastAssistant = [...conv.messages]
							.reverse()
							.find((m) => m.from === "assistant") as Message | undefined;
						const isTerminal = isAssistantGenerationTerminal(lastAssistant);

						const event: ConvUpdate = {
							id: conv._id.toString(),
							title: conv.title,
							updatedAt: conv.updatedAt.toISOString(),
							isTerminal,
						};

						controller.enqueue(encode(event));

						// Advance cursor to avoid re-emitting the same conversation on
						// the next tick (use max of current cursor and this conv's updatedAt).
						if (conv.updatedAt > cursor) {
							cursor = conv.updatedAt;
						}
					}

					if (changed.length === 0) {
						sendHeartbeat();
					}
				} catch (err) {
					// Log and continue — transient DB errors should not kill the stream.
					console.error("[conversation-updates SSE] poll error", err);
					sendHeartbeat();
				}
			}

			// Graceful close: tell the client it should reconnect.
			try {
				controller.close();
			} catch {
				// already closed by abort
			}
		},
	});

	return new Response(stream, {
		headers: {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
			// Allow client-side JS to read this response (CORS if needed)
			"X-Accel-Buffering": "no",
		},
	});
};
