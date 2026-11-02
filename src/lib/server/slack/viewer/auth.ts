import { createHmac, timingSafeEqual } from "node:crypto";
import { Issuer } from "openid-client";
import { WebClient } from "@slack/web-api";
import { z } from "zod";
import { error, type RequestEvent } from "@sveltejs/kit";
import { config } from "$lib/server/config";
import { slackConfig } from "../config";
import { isWorkspaceMember } from "../context";
import type { SlackThread } from "../types";
import { collections } from "$lib/server/database";
import { ObjectId } from "mongodb";
import { base } from "$app/paths";

export const sessionCookie = "__Secure-ml-slack-identity-v2";
export const flowCookie = "__Secure-ml-slack-login";
export const cookieOptions = {
	path: `${base}/slack`,
	httpOnly: true,
	secure: true,
	sameSite: "lax" as const,
};
export function viewerConfig() {
	const parsed = z
		.object({
			origin: z.string().url(),
			clientId: z.string().min(1),
			clientSecret: z.string().min(1),
			secret: z.string().min(32),
		})
		.safeParse({
			origin: config.SLACK_ML_VIEWER_ORIGIN,
			clientId: config.SLACK_ML_VIEWER_CLIENT_ID,
			clientSecret: config.SLACK_ML_VIEWER_CLIENT_SECRET,
			secret: config.SLACK_ML_VIEWER_SESSION_SECRET,
		});
	if (!parsed.success) return;
	const url = new URL(parsed.data.origin);
	if (
		url.protocol !== "https:" ||
		url.username ||
		url.password ||
		url.pathname !== "/" ||
		url.search ||
		url.hash
	)
		return;
	return { ...parsed.data, origin: url.origin };
}
export function viewerLink(id: string): string | undefined {
	const settings = viewerConfig();
	return settings ? `${settings.origin}${base}/slack/view/${id}` : undefined;
}
export function sign(value: object, secret: string): string {
	const body = Buffer.from(JSON.stringify(value)).toString("base64url");
	return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}
export function verify(value: string | undefined, secret: string): unknown {
	if (!value || value.length > 4096) return;
	const [body, signature, extra] = value.split(".");
	if (!body || !signature || extra) return;
	const expected = createHmac("sha256", secret).update(body).digest();
	const actual = Buffer.from(signature, "base64url");
	if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return;
	try {
		return JSON.parse(Buffer.from(body, "base64url").toString());
	} catch {
		return;
	}
}
export const identitySchema = z.object({
	team: z.string().regex(/^T[A-Z0-9]+$/),
	user: z.string().regex(/^[UW][A-Z0-9]+$/),
	expires: z.number().gt(0),
});
export type ViewerIdentity = z.infer<typeof identitySchema>;
export function identity(event: Pick<RequestEvent, "cookies">): ViewerIdentity | undefined {
	const settings = viewerConfig();
	if (!settings) return;
	const parsed = identitySchema.safeParse(
		verify(event.cookies.get(sessionCookie), settings.secret)
	);
	if (parsed.success && parsed.data.expires > Date.now()) return parsed.data;
}
let issuer: Promise<Issuer> | undefined;
export async function oidcClient() {
	const settings = viewerConfig();
	if (!settings) error(503, "Slack viewer is not configured.");
	issuer ??= Issuer.discover("https://slack.com").catch((e) => {
		issuer = undefined;
		throw e;
	});
	return new (await issuer).Client({
		client_id: settings.clientId,
		client_secret: settings.clientSecret,
		redirect_uris: [`${settings.origin}${base}/slack/view/callback`],
		response_types: ["code"],
		id_token_signed_response_alg: "RS256",
	});
}
const membershipCache = new Map<string, { until: number; value: Promise<boolean> }>();
const viewerRequests = new Map<string, number>();
/** Bounded 60s cache; concurrent tabs share the same membership lookup. Failures are evicted. */
export async function canView(
	thread: SlackThread,
	viewer: ViewerIdentity,
	client: WebClient
): Promise<boolean> {
	if (thread.hfUserId || viewer.team !== thread.teamId || viewer.expires <= Date.now())
		return false;
	const key = `${viewer.team}:${viewer.user}:${thread.channel}:${thread.owner}`;
	const now = Date.now();
	for (const [key, value] of membershipCache) if (value.until <= now) membershipCache.delete(key);
	const cached = membershipCache.get(key);
	if (cached) return cached.value;
	if (membershipCache.size >= 1000)
		membershipCache.delete(membershipCache.keys().next().value ?? "");
	const value = checkMembership(thread, viewer, client).catch((error) => {
		membershipCache.delete(key);
		throw error;
	});
	membershipCache.set(key, { until: now + 60_000, value });
	return value;
}
/** Check Slack membership; outages never fall back to access. */
async function checkMembership(
	thread: SlackThread,
	viewer: ViewerIdentity,
	client: WebClient
): Promise<boolean> {
	if (thread.hfUserId || viewer.team !== thread.teamId) return false;
	const result = await client.users.info({ user: viewer.user });
	if (!result.user || !isWorkspaceMember(result.user, thread.teamId)) return false;
	if (thread.channel.startsWith("D")) return thread.owner === viewer.user;
	const info = await client.conversations.info({ channel: thread.channel });
	if (!info.channel || info.channel.is_ext_shared) return false;
	let cursor: string | undefined;
	do {
		const page = await client.conversations.members({
			channel: thread.channel,
			limit: 1000,
			cursor,
		});
		if (page.members?.includes(viewer.user)) return true;
		cursor = page.response_metadata?.next_cursor || undefined;
	} while (cursor);
	return false;
}
export async function authorizedThread(event: RequestEvent) {
	const viewer = identity(event);
	if (!viewer) error(401, "Sign in with Slack to inspect this session.");
	const throttleKey = `${viewer.team}:${viewer.user}`;
	const now = Date.now();
	for (const [key, until] of viewerRequests) if (until <= now) viewerRequests.delete(key);
	if (viewerRequests.has(throttleKey))
		error(429, "Please wait a moment before refreshing this session.");
	if (viewerRequests.size >= 1000) error(503, "Viewer is busy. Try again shortly.");
	viewerRequests.set(throttleKey, now + 2000);
	const settings = slackConfig();
	if (!settings || !viewerConfig()) error(503, "Slack viewer is not configured.");
	const id = event.params.id;
	if (!id || !/^[a-f0-9]{24}$/.test(id)) error(404, "Session not found.");
	const thread = await collections.slackThreads.findOne({
		conversationId: new ObjectId(id),
		teamId: settings.teamId,
	});
	if (
		!thread ||
		(settings.allowedChannels.length && !settings.allowedChannels.includes(thread.channel))
	)
		error(403, "You cannot access this session.");
	let allowed = false;
	try {
		allowed = await canView(
			thread,
			viewer,
			new WebClient(settings.botToken, {
				retryConfig: { retries: 0 },
				rejectRateLimitedCalls: true,
				timeout: 10000,
			})
		);
	} catch {
		error(503, "Could not verify Slack access. Try again shortly.");
	}
	if (!allowed) error(403, "You cannot access this session.");
	return thread;
}
