import pino from "pino";
import { dev } from "$app/environment";
import { env } from "$env/dynamic/private";

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

export const logger = pino({ ...options, level: env.LOG_LEVEL ?? "info" });
