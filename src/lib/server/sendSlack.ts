import { env } from "$env/dynamic/private";
import { logger } from "$lib/server/logger";

export async function sendSlack(text: string) {
	if (!env.WEBHOOK_URL_REPORT_ASSISTANT) {
		logger.warn("WEBHOOK_URL_REPORT_ASSISTANT is not set, tried to send a slack message.");
		return;
	}

	const res = await fetch(env.WEBHOOK_URL_REPORT_ASSISTANT, {
		method: "POST",
		headers: {
			"Content-type": "application/json",
		},
		body: JSON.stringify({
			text,
		}),
	});

	if (!res.ok) {
		logger.error(`Webhook message failed. ${res.statusText} ${res.text}`);
	}
}
