import { base } from "$app/paths";
import { logger } from "$lib/server/logger";
import type { MlWatchedItem } from "$lib/types/MlAutomation";

const HUB = "https://huggingface.co";

export class HubWebhookError extends Error {}

export function receiverUrl(origin: string, automationId: string): URL {
	return new URL(`${base}/api/v2/ml-automations/${automationId}/webhook`, new URL(origin).origin);
}

/** otherwise the owner registers the webhook by hand, from wherever the hub can reach */
export const hubCanReach = (url: URL) =>
	url.protocol === "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);

export async function registerWebhook(opts: {
	token: string;
	url: URL;
	secret: string;
	watched: MlWatchedItem[];
}): Promise<string> {
	const response = await fetch(`${HUB}/api/settings/webhooks`, {
		method: "POST",
		headers: { Authorization: `Bearer ${opts.token}`, "Content-Type": "application/json" },
		body: JSON.stringify({
			watched: opts.watched,
			domains: ["repo"],
			url: opts.url.toString(),
			secret: opts.secret,
		}),
		signal: AbortSignal.timeout(15_000),
	});
	if (!response.ok) {
		const detail = await response.text().catch(() => "");
		throw new HubWebhookError(
			response.status === 401 || response.status === 403
				? "The Hub refused to create the webhook. The token needs permission to manage webhooks and to read what it watches."
				: `The Hub could not create the webhook (${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}).`
		);
	}
	const body = (await response.json().catch(() => undefined)) as
		{ webhook?: { id?: unknown } } | undefined;
	const id = body?.webhook?.id;
	if (typeof id !== "string" || !id) throw new HubWebhookError("The Hub returned no webhook id.");
	return id;
}

/** best effort, a webhook left behind only reaches a receiver that no longer knows it */
export async function removeWebhook(token: string, webhookId: string): Promise<void> {
	const response = await fetch(`${HUB}/api/settings/webhooks/${encodeURIComponent(webhookId)}`, {
		method: "DELETE",
		headers: { Authorization: `Bearer ${token}` },
		signal: AbortSignal.timeout(15_000),
	}).catch((err) => {
		logger.warn({ err, webhookId }, "[ml automations] could not delete the hub webhook");
		return undefined;
	});
	if (response && !response.ok && response.status !== 404)
		logger.warn(
			{ webhookId, status: response.status },
			"[ml automations] the hub refused to delete the webhook"
		);
}
