import pino from "pino";
import { dev } from "$app/environment";
import { config } from "$lib/server/config";
import { getRequestId } from "$lib/server/requestContext";

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

const baseLogger = pino({
	...options,
	messageKey: "message",
	level: config.LOG_LEVEL || "info",
	formatters: {
		level: (label) => {
			return { level: label };
		},
	},
	mixin() {
		const requestId = getRequestId();
		return requestId ? { requestId } : {};
	},
});

export const logger = baseLogger;
