import { randomUUID } from "$lib/utils/randomUuid";
import { timeout } from "$lib/utils/timeout";
import { logger } from "./logger";

type ExitHandler = () => void | Promise<void>;
type ExitHandlerUnsubscribe = () => void;

const listeners = new Map<string, ExitHandler>();

export function onExit(cb: ExitHandler): ExitHandlerUnsubscribe {
	const uuid = randomUUID();
	listeners.set(uuid, cb);
	return () => {
		listeners.delete(uuid);
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
		signalCount++;
		if (signalCount === 1) {
			logger.info("Received signal... Exiting");
			await Promise.all(Array.from(listeners.values()).map(runExitHandler));
			logger.info("All exit handlers ran... Waiting for svelte server to exit");
		}
		if (signalCount === 3) {
			logger.warn("Received 3 signals... Exiting immediately");
			process.exit(1);
		}
	};

	process.on("SIGINT", exitHandler);
	process.on("SIGTERM", exitHandler);
}
