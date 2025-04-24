import pino from "pino";
import { dev } from "$app/environment";
import { config } from "$lib/server/config";

let options: pino.LoggerOptions = {};

if (dev) {
	options = {
		transport: {
			target: "pino-pretty",
			options: {
				colorize: true,
			},
		},
	};
}

export const logger = pino({ ...options, level: config.LOG_LEVEL || "info" });
