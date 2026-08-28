import type { RequestHandler } from "./$types";
import type { ObjectId } from "mongodb";
import { collections } from "$lib/server/database";
import { authCondition } from "$lib/server/auth";

/**
 * Cross-conversation liveness feed. Reports the user's own running generations —
 * plus turns parked on the wait or ask tools — so the sidebar can show each
 * conversation's status and toast when a background one finishes, without a
 * per-conversation stream for each.
 *
 * Scoped by `authCondition` against the denormalised user/session on `generations`
 * and `turnStates` (no join). SSE: `event: sync {running, ended, parked}` each
 * tick; `event: idle` when the user has no running generations AND no parked
 * turns, after which the client closes rather than reconnecting (a plain
 * lifetime-cap close, by contrast, means reconnect). A parked turn therefore
 * holds the feed open: its resume happens server-side with no client action, so
 * only a live feed can ever report it.
 */
const TICK_MS = 2_000;
const MAX_LIFETIME_MS = 5 * 60_000;
// Release the connection once nothing is running; the client reopens on the next run.
const IDLE_TICKS_BEFORE_CLOSE = 2;
// How long a failed turn keeps its sidebar flag (the state doc itself lives a week).
const FAILED_WINDOW_MS = 24 * 60 * 60 * 1000;

export const GET: RequestHandler = async ({ locals, request }) => {
	let auth: ReturnType<typeof authCondition>;
	try {
		auth = authCondition(locals);
	} catch {
		return new Response("Unauthorized", { status: 401 });
	}

	const encoder = new TextEncoder();

	const stream = new ReadableStream({
		async start(controller) {
			const signal = request.signal;
			const deadline = Date.now() + MAX_LIFETIME_MS;

			const send = (event: string, data: unknown) =>
				controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));

			// generationIds seen running on the previous tick, to detect endings.
			let prevRunning = new Set<string>();
			let idleTicks = 0;

			const titlesFor = async (ids: ObjectId[]) => {
				const map = new Map<string, string>();
				if (ids.length === 0) return map;
				const convs = await collections.conversations
					.find({ _id: { $in: ids } }, { projection: { title: 1 } })
					.toArray();
				for (const c of convs) map.set(c._id.toString(), c.title ?? "");
				return map;
			};

			// One sweep. Returns false when the user has been idle long enough to close.
			const tick = async (): Promise<boolean> => {
				const running = await collections.generations
					.find(
						{ status: "running", ...auth },
						{ projection: { generationId: 1, conversationId: 1 } }
					)
					.toArray();

				// Parked turns have no running generation, so they come from the
				// authoritative turn-state docs instead. Recent failures ride along so
				// the sidebar can flag a run that died in the background — bounded to a
				// day because the docs themselves live a week (see the TTL), and a
				// week-old failure is history, not a status.
				const parked = await collections.turnStates
					.find(
						{
							...auth,
							$or: [
								{ status: { $in: ["waiting", "awaiting_input"] } },
								{ status: "failed", endedAt: { $gt: new Date(Date.now() - FAILED_WINDOW_MS) } },
							],
						},
						{ projection: { conversationId: 1, status: 1 } }
					)
					.toArray();
				const parkedPayload = parked.map((turn) => ({
					conversationId: turn.conversationId.toString(),
					status: turn.status,
				}));

				const currentIds = new Set(running.map((g) => g.generationId));
				const endedIds = [...prevRunning].filter((id) => !currentIds.has(id));

				const runningTitles = await titlesFor(running.map((g) => g.conversationId));
				const runningPayload = running.map((g) => ({
					conversationId: g.conversationId.toString(),
					title: runningTitles.get(g.conversationId.toString()) ?? "",
				}));

				let endedPayload: Array<{ conversationId: string; status: string; title: string }> = [];
				if (endedIds.length > 0) {
					const endedGens = await collections.generations
						.find(
							{ generationId: { $in: endedIds } },
							{ projection: { conversationId: 1, status: 1 } }
						)
						.toArray();
					const endedTitles = await titlesFor(endedGens.map((g) => g.conversationId));
					endedPayload = endedGens.map((g) => ({
						conversationId: g.conversationId.toString(),
						status: g.status,
						title: endedTitles.get(g.conversationId.toString()) ?? "",
					}));
				}

				send("sync", { running: runningPayload, ended: endedPayload, parked: parkedPayload });
				prevRunning = currentIds;
				// Failed turns are terminal: they never change server-side, so unlike
				// the parked states they must not hold the feed open. The last sync
				// before the idle close already delivered them.
				const liveParked = parked.some((turn) => turn.status !== "failed");
				idleTicks = currentIds.size === 0 && !liveParked ? idleTicks + 1 : 0;
				return idleTicks < IDLE_TICKS_BEFORE_CLOSE;
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
					}, TICK_MS);
					signal.addEventListener("abort", onAbort, { once: true });
				});

			try {
				let alive = await tick();
				while (alive && !signal.aborted && Date.now() < deadline) {
					await sleep();
					if (signal.aborted) break;
					alive = await tick();
				}
				if (!alive) send("idle", {});
			} catch {
				// Transient — fall through to a plain close so the client reconnects.
			}

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
