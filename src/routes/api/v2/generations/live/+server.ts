import type { RequestHandler } from "./$types";
import type { ObjectId } from "mongodb";
import { collections } from "$lib/server/database";
import { authCondition } from "$lib/server/auth";

/**
 * Cross-conversation liveness feed. Reports the user's own running generations so
 * the sidebar can show which conversations are generating and toast when a
 * background one finishes — without a per-conversation stream for each.
 *
 * Scoped by `authCondition` against the denormalised user/session on `generations`
 * (no join). SSE: `event: sync {running, ended}` each tick; `event: idle` when the
 * user has no running generations, after which the client closes rather than
 * reconnecting (a plain lifetime-cap close, by contrast, means reconnect).
 */
const TICK_MS = 2_000;
const MAX_LIFETIME_MS = 5 * 60_000;
// Release the connection once nothing is running; the client reopens on the next run.
const IDLE_TICKS_BEFORE_CLOSE = 2;

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

				send("sync", { running: runningPayload, ended: endedPayload });
				prevRunning = currentIds;
				idleTicks = currentIds.size === 0 ? idleTicks + 1 : 0;
				return idleTicks < IDLE_TICKS_BEFORE_CLOSE;
			};

			const sleep = () =>
				new Promise<void>((resolve) => {
					const t = setTimeout(resolve, TICK_MS);
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
