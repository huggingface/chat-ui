import type { RequestHandler } from "./$types";
import { collections } from "$lib/server/database";
import { authCondition } from "$lib/server/auth";
import { generationEventsEnabled } from "$lib/server/generation/writer";
import { error } from "@sveltejs/kit";
import { ObjectId } from "mongodb";
import { z } from "zod";

/**
 * Reattach to a running (or recently finished) generation. Owns no generation — reads
 * the append-only `generationEvents` log, so it works from any tab, device, or pod.
 * Replays events after `fromSeq`, then tails until the run is terminal (the reaper
 * guarantees that even if the producing pod died).
 *
 * SSE: `event: update` carries a MessageUpdate tagged `id: <seq>`, so EventSource
 * resumes via Last-Event-ID on reconnect; `event: end {status}` is terminal and the
 * client closes; a plain close (lifetime cap / transient) means reconnect.
 */
const TAIL_INTERVAL_MS = 250;
// Cap the connection so it churns rather than ageing behind a proxy; the client reconnects.
const MAX_LIFETIME_MS = 5 * 60_000;
const REPLAY_BATCH = 500;

export const GET: RequestHandler = async ({ params, locals, url, request }) => {
	if (!generationEventsEnabled()) error(404, "Not found");

	const convId = new ObjectId(z.string().parse(params.id));

	const conv = await collections.conversations.findOne(
		{ _id: convId, ...authCondition(locals) },
		{ projection: { _id: 1 } }
	);
	if (!conv) error(404, "Conversation not found");

	const generationIdParam = url.searchParams.get("generationId") ?? undefined;

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

			// Explicit id, else the newest run for this conversation.
			const gen = await (
				generationIdParam
					? collections.generations.findOne({
							generationId: generationIdParam,
							conversationId: convId,
						})
					: collections.generations.findOne({ conversationId: convId }, { sort: { startedAt: -1 } })
			).catch(() => null);

			if (!gen) {
				sendEnd("gone");
				controller.close();
				return;
			}
			const generationId = gen.generationId;

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
				await drain();

				while (!signal.aborted && Date.now() < deadline) {
					const current = await collections.generations.findOne(
						{ generationId },
						{ projection: { status: 1 } }
					);
					const status = current?.status ?? "gone";

					if (status !== "running") {
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
