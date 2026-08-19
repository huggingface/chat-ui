import { collections } from "$lib/server/database";
import { config } from "$lib/server/config";
import { logger } from "$lib/server/logger";
import { onExit } from "$lib/server/exitHandler";
import { markGenerationInterrupted, finalizeActiveRunsOnExit } from "./finalize";

const REAP_BATCH = 200;

function reapIntervalMs(): number {
	const raw = config.GENERATION_REAP_INTERVAL_MS;
	if (raw) {
		const parsed = parseInt(raw, 10);
		if (!isNaN(parsed) && parsed > 0) return parsed;
	}
	return 60_000;
}

// Must stay well above the heartbeat interval (see writer.ts) or a live but jittery
// pod is reaped between beats. The 90s default is ~9 missed 10s beats. Configurable
// only so tests can scale both timers down together.
function reapAfterMs(): number {
	const raw = config.GENERATION_REAP_AFTER_MS;
	if (raw) {
		const parsed = parseInt(raw, 10);
		if (!isNaN(parsed) && parsed > 0) return parsed;
	}
	return 90_000;
}

// A run whose pod died stays `status: running` with a frozen heartbeat forever;
// nothing else finalizes it, so it would spin or present its partial output as a
// finished answer. Mark it interrupted instead.
export async function reapStaleGenerations(): Promise<void> {
	const threshold = new Date(Date.now() - reapAfterMs());
	const stale = await collections.generations
		.find({ status: "running", lastHeartbeatAt: { $lt: threshold } })
		.limit(REAP_BATCH)
		.toArray();
	if (stale.length === 0) return;

	logger.warn({ count: stale.length }, "[generation] reaping runs with stale heartbeat");
	await Promise.all(
		stale.map((g) =>
			markGenerationInterrupted(g.generationId, {
				conversationId: g.conversationId,
				messageId: g.messageId,
			}).catch((err) =>
				logger.error({ err, generationId: g.generationId }, "[generation] failed to reap run")
			)
		)
	);
}

export class GenerationReaper {
	private static instance: GenerationReaper;

	private constructor() {
		const interval = setInterval(() => {
			reapStaleGenerations().catch((err) =>
				logger.error({ err }, "[generation] reaper sweep failed")
			);
		}, reapIntervalMs());
		interval.unref?.();
		onExit(() => clearInterval(interval));
		// A graceful shutdown finalizes this pod's runs at once, not one sweep later.
		onExit(() => finalizeActiveRunsOnExit());

		reapStaleGenerations().catch((err) =>
			logger.error({ err }, "[generation] initial reaper sweep failed")
		);
	}

	public static getInstance(): GenerationReaper {
		if (!GenerationReaper.instance) {
			GenerationReaper.instance = new GenerationReaper();
		}
		return GenerationReaper.instance;
	}
}
