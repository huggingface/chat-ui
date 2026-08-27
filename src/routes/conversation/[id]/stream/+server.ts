import type { RequestHandler } from "./$types";
import { collections } from "$lib/server/database";
import { authCondition } from "$lib/server/auth";
import { error } from "@sveltejs/kit";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { isTurnAlive, latestTurnGeneration, turnEventsAfter } from "$lib/server/generation/turnLog";

/**
 * Subscribe to a TURN: replay the turn-scoped event log after `fromSeq`, then
 * tail until the turn is over. Owns no generation — the log is keyed by the
 * assistant message, and a resumed producer continues the same sequence, so
 * the subscription survives park/resume cycles without the client ever
 * learning a new identity. Works from any tab, device, or pod.
 *
 * SSE: `event: update` carries a MessageUpdate tagged `id: <seq>`, so
 * EventSource resumes via Last-Event-ID on reconnect; `event: end {status}` is
 * terminal and the client closes; a plain close (lifetime cap / transient)
 * means reconnect — lossless by construction, the cursor is turn-scoped.
 */
const TAIL_INTERVAL_MS = 250;
// Cap the connection so it churns rather than ageing behind a proxy; the client reconnects.
const MAX_LIFETIME_MS = 5 * 60_000;
const REPLAY_BATCH = 500;

export const GET: RequestHandler = async ({ params, locals, url, request }) => {
	const convId = new ObjectId(z.string().parse(params.id));

	const conv = await collections.conversations.findOne(
		{ _id: convId, ...authCondition(locals) },
		{ projection: { _id: 1 } }
	);
	if (!conv) error(404, "Conversation not found");

	// The turn key. A pre-turn-scoped client may still send only a
	// generationId; resolve it to its message so a stale tab keeps working
	// across the deploy boundary.
	let messageId = url.searchParams.get("messageId") ?? undefined;
	if (!messageId) {
		const generationIdParam = url.searchParams.get("generationId");
		if (generationIdParam) {
			const gen = await collections.generations
				.findOne({ generationId: generationIdParam, conversationId: convId })
				.catch(() => null);
			messageId = gen?.messageId;
		}
	}

	// Resent by EventSource on reconnect; wins over the query param.
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

			if (!messageId || !(await latestTurnGeneration(convId, messageId))) {
				sendEnd("gone");
				controller.close();
				return;
			}
			const turnMessageId = messageId;

			const drain = async (): Promise<number> => {
				let emitted = 0;
				for (;;) {
					const batch = await turnEventsAfter(convId, turnMessageId, cursor, REPLAY_BATCH);
					let sawGap = false;
					for (const e of batch) {
						// An unordered multi-document insert is not atomically visible.
						// Do not advance past a sequence that may appear on the next poll,
						// or it can never be emitted to this connection.
						if (e.seq !== cursor + 1) {
							sawGap = true;
							break;
						}
						sendUpdate(e.seq, e.event);
						cursor = e.seq;
						emitted++;
					}
					if (sawGap || batch.length < REPLAY_BATCH) break;
				}
				return emitted;
			};

			const sleep = () =>
				new Promise<void>((resolve) => {
					// Remove the listener when the timer wins, or one accumulates per tick for
					// the whole connection (only {once} cleans up, and only on abort).
					const onAbort = () => {
						clearTimeout(t);
						resolve();
					};
					const t = setTimeout(() => {
						signal.removeEventListener("abort", onAbort);
						resolve();
					}, TAIL_INTERVAL_MS);
					signal.addEventListener("abort", onAbort, { once: true });
				});

			try {
				await drain();

				while (!signal.aborted && Date.now() < deadline) {
					const { alive, status } = await isTurnAlive(convId, turnMessageId);

					if (!alive) {
						// finish() appends its last events before flipping status, so a terminal
						// read means they are all on disk — drain once more before ending.
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
				// Transient — fall through to a plain close so the client reconnects.
			}

			// No `end`: a plain close tells EventSource to reconnect with its Last-Event-ID.
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
