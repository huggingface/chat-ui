import type { RequestHandler } from "./$types";
import { collections } from "$lib/server/database";
import { authCondition } from "$lib/server/auth";
import { generationEventsEnabled } from "$lib/server/generation/writer";
import { error } from "@sveltejs/kit";
import { ObjectId } from "mongodb";
import { z } from "zod";

/**
 * Reattach to a running (or recently finished) generation and stream its events.
 *
 * Unlike the POST that starts a generation, this owns no generation — it reads the
 * append-only `generationEvents` log, so it works from any tab, any device, or any
 * pod. It replays everything after `fromSeq`, then tails for new events until the run
 * reaches a terminal status (the reaper guarantees that happens even if the producing
 * pod died). This is what lets a returning viewer resume a 30-minute run at the token
 * it left off instead of polling and reloading the whole conversation.
 *
 * Protocol (SSE):
 *   id: <seq>            — every update carries its sequence number, so the browser's
 *   event: update          EventSource replays it as `Last-Event-ID` on auto-reconnect,
 *   data: <MessageUpdate>  resuming exactly where it dropped with no client bookkeeping.
 *
 *   event: end           — the run is terminal; the client should close (not reconnect).
 *   data: { status }
 *
 *   : heartbeat          — keep-alive while the run is quiet.
 *
 * A plain close without an `end` event (lifetime cap or transient error) is the signal
 * to reconnect with `Last-Event-ID`.
 */
const TAIL_INTERVAL_MS = 250;
// Mirrors the other SSE endpoint: cap the connection so EventSource reconnects and
// connections churn rather than ageing indefinitely behind a proxy.
const MAX_LIFETIME_MS = 5 * 60_000;
const REPLAY_BATCH = 500;

export const GET: RequestHandler = async ({ params, locals, url, request }) => {
	// No event log means nothing to reattach to; the client never opens this when the
	// feature is off, so a 404 is only reached by a stray request.
	if (!generationEventsEnabled()) error(404, "Not found");

	const convId = new ObjectId(z.string().parse(params.id));

	// Authorize by conversation ownership, exactly as the POST does.
	const conv = await collections.conversations.findOne(
		{ _id: convId, ...authCondition(locals) },
		{ projection: { _id: 1 } }
	);
	if (!conv) error(404, "Conversation not found");

	const generationIdParam = url.searchParams.get("generationId") ?? undefined;

	// Last-Event-ID (sent by EventSource on auto-reconnect) wins over the query param.
	const lastEventId = request.headers.get("last-event-id");
	const fromSeqRaw = lastEventId ?? url.searchParams.get("fromSeq") ?? "0";
	const parsedFromSeq = Number.parseInt(fromSeqRaw, 10);
	const initialFromSeq = Number.isFinite(parsedFromSeq) && parsedFromSeq >= 0 ? parsedFromSeq : 0;

	const encoder = new TextEncoder();

	const stream = new ReadableStream({
		async start(controller) {
			const signal = request.signal;
			const deadline = Date.now() + MAX_LIFETIME_MS;
			let cursor = initialFromSeq;

			const enc = (s: string) => controller.enqueue(encoder.encode(s));
			const sendUpdate = (seq: number, event: unknown) =>
				enc(`id: ${seq}\nevent: update\ndata: ${JSON.stringify(event)}\n\n`);
			const sendEnd = (status: string) =>
				enc(`event: end\ndata: ${JSON.stringify({ status })}\n\n`);
			const sendHeartbeat = () => enc(": heartbeat\n\n");

			// Resolve the run: an explicit id (the one stamped on the message the client is
			// rendering), else the newest generation for this conversation.
			const gen = await (
				generationIdParam
					? collections.generations.findOne({
							generationId: generationIdParam,
							conversationId: convId,
						})
					: collections.generations.findOne({ conversationId: convId }, { sort: { startedAt: -1 } })
			).catch(() => null);

			if (!gen) {
				// The run is gone (never existed, or its record aged out). Nothing to stream.
				sendEnd("gone");
				controller.close();
				return;
			}
			const generationId = gen.generationId;

			// Emit every event past the cursor, in order, advancing the cursor as we go.
			const drain = async (): Promise<number> => {
				let emitted = 0;
				for (;;) {
					const batch = await collections.generationEvents
						.find({ generationId, seq: { $gt: cursor } })
						.sort({ seq: 1 })
						.limit(REPLAY_BATCH)
						.toArray();
					for (const e of batch) {
						sendUpdate(e.seq, e.event);
						cursor = e.seq;
						emitted++;
					}
					if (batch.length < REPLAY_BATCH) break;
				}
				return emitted;
			};

			const sleep = () =>
				new Promise<void>((resolve) => {
					const t = setTimeout(resolve, TAIL_INTERVAL_MS);
					signal.addEventListener(
						"abort",
						() => {
							clearTimeout(t);
							resolve();
						},
						{ once: true }
					);
				});

			try {
				// Initial replay from the cursor.
				await drain();

				while (!signal.aborted && Date.now() < deadline) {
					const current = await collections.generations.findOne(
						{ generationId },
						{ projection: { status: 1 } }
					);
					const status = current?.status ?? "gone";

					if (status !== "running") {
						// Drain once more: `finish()` appends its last events before flipping
						// the status, so a terminal read means everything is on disk now.
						await drain();
						sendEnd(status);
						controller.close();
						return;
					}

					await sleep();
					if (signal.aborted) break;
					const emitted = await drain();
					if (emitted === 0) sendHeartbeat();
				}
			} catch {
				// Transient failure — fall through to a plain close so the client reconnects.
			}

			// Lifetime cap or abort: close with no `end`, so EventSource reconnects with
			// its Last-Event-ID and picks up where this connection stopped.
			try {
				controller.close();
			} catch {
				// already closed
			}
		},
	});

	return new Response(stream, {
		headers: {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache, no-transform",
			Connection: "keep-alive",
			"X-Accel-Buffering": "no",
		},
	});
};
