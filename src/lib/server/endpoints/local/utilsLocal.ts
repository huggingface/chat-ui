import { getLlama } from "node-llama-cpp";
import { logger } from "$lib/server/logger";
import { building } from "$app/environment";
export const llama = await getLlama({
	logger: (level, message) => {
		// Log messages based on their level
		switch (level) {
			case "fatal":
				logger.fatal(message);
				break;
			case "error":
				logger.error(message);
				break;
			case "warn":
				logger.warn(message);
				break;
			case "info":
				logger.info(message);
				break;
			case "log":
				logger.info(message); // Map 'log' to 'info' since pino doesn't have a 'log' level
				break;
			case "debug":
				logger.debug(message);
				break;
			default:
				// For 'disabled' or any other unexpected levels
				break;
		}
	},
	build: building ? "try" : "never",
});

if (building) {
	// lazy load llama
	llama.getSwapState();
}
