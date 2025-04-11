import { getLlama } from "node-llama-cpp";
import { logger } from "$lib/server/logger";

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
	build: "never",
}).catch((e) => {
	logger.warn(
		e,
		"Failed to initialize llama.cpp. This won't break anything if you're not using the \"local\" endpoint."
	);
	return undefined;
});
