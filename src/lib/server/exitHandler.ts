import { randomUUID } from "$lib/utils/randomUuid";
import { timeout } from "$lib/utils/timeout";
import { logger } from "./logger";

type ExitHandler = () => void | Promise<void>;
type ExitHandlerUnsubscribe = () => void;

const listeners = new Map<string, ExitHandler>();
// Handlers that must run after all the others (e.g. closing the database), so their
// teardown does not race work the normal handlers still need to flush.
const finalListeners = new Map<string, ExitHandler>();

export function onExit(cb: ExitHandler, opts?: { last?: boolean }): ExitHandlerUnsubscribe {
	const uuid = randomUUID();
	const map = opts?.last ? finalListeners : listeners;
	map.set(uuid, cb);
	return () => {
		map.delete(uuid);
	};
}

async function runExitHandler(handler: ExitHandler): Promise<void> {
	return timeout(Promise.resolve().then(handler), 30_000).catch((err) => {
		logger.error(err, "Exit handler failed to run");
	});
}

export function initExitHandler() {
	let signalCount = 0;
	const exitHandler = async () => {
		if (signalCount === 1) {
			logger.info("Received signal... Exiting");
			// Normal handlers first (e.g. finalizing in-flight generations), then the ones
			// registered `last` (closing the database) so those writes are not racing a
			// force-closed client.
			await Promise.all(Array.from(listeners.values()).map(runExitHandler));
			await Promise.all(Array.from(finalListeners.values()).map(runExitHandler));
			logger.info("All exit handlers ran... Waiting for svelte server to exit");
		}
	};

	process.on("SIGINT", () => {
		signalCount++;

		if (signalCount >= 2) {
			process.kill(process.pid, "SIGKILL");
		} else {
			exitHandler().catch((err) => {
				logger.error(err, "Error in exit handler on SIGINT:");
				process.kill(process.pid, "SIGKILL");
			});
		}
	});

	process.on("SIGTERM", () => {
		signalCount++;

		if (signalCount >= 2) {
			process.kill(process.pid, "SIGKILL");
		} else {
			exitHandler().catch((err) => {
				logger.error(err, "Error in exit handler on SIGTERM:");
				process.kill(process.pid, "SIGKILL");
			});
		}
	});
}
