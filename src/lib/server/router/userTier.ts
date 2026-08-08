import { config } from "$lib/server/config";
import { logger } from "$lib/server/logger";

export type UserTier = "free" | "paid";

interface HubUserInfoOrg {
	preferred_username?: string;
	plan?: string;
	canPay?: boolean;
}

interface HubUserInfo {
	isPro?: boolean;
	canPay?: boolean;
	orgs?: HubUserInfoOrg[];
}

type CacheEntry =
	| { kind: "data"; isPro: boolean; canPay: boolean; payingOrgs: string[]; expiresAt: number }
	| { kind: "error"; expiresAt: number };

const USERINFO_URL = "https://huggingface.co/oauth/userinfo";
const FETCH_TIMEOUT_MS = 5_000;
// The Hub rate-limits userinfo within the same budget as the user's own page views, so tier
// lookups must be cached; payment status only changes on subscribe/top-up anyway.
const DATA_TTL_MS = 10 * 60_000;
// Failures resolve as "paid" (fail open); keep them short-lived so recovery is quick.
const ERROR_TTL_MS = 60_000;
const SWEEP_INTERVAL_MS = 60_000;

const cache = new Map<string, CacheEntry>();
let sweeper: ReturnType<typeof setInterval> | undefined;

function ensureSweeper() {
	if (sweeper) return;
	sweeper = setInterval(() => {
		const now = Date.now();
		for (const [key, entry] of cache) {
			if (entry.expiresAt <= now) cache.delete(key);
		}
	}, SWEEP_INTERVAL_MS);
	sweeper.unref?.();
}

/** The model free users are pinned to ("" when free-tier routing is disabled). */
export function getFreeUserModel(): string {
	return (config.LLM_ROUTER_FREE_USER_MODEL || "").trim();
}

async function fetchUserBilling(token: string): Promise<HubUserInfo> {
	const response = await fetch(USERINFO_URL, {
		headers: { Authorization: `Bearer ${token}` },
		signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
	});
	if (!response.ok) {
		throw new Error(`userinfo returned ${response.status}`);
	}
	return (await response.json()) as HubUserInfo;
}

async function getCacheEntry(userId: string, token: string): Promise<CacheEntry> {
	const existing = cache.get(userId);
	if (existing && existing.expiresAt > Date.now()) {
		return existing;
	}

	let entry: CacheEntry;
	try {
		const data = await fetchUserBilling(token);
		entry = {
			kind: "data",
			isPro: data.isPro === true,
			canPay: data.canPay === true,
			payingOrgs: (data.orgs ?? [])
				.filter((org) => org.canPay === true || Boolean(org.plan))
				.map((org) => org.preferred_username)
				.filter((name): name is string => Boolean(name)),
			expiresAt: Date.now() + DATA_TTL_MS,
		};
		logger.debug(
			{ userId, isPro: entry.isPro, canPay: entry.canPay, payingOrgs: entry.payingOrgs.length },
			"[userTier] refreshed user billing status"
		);
	} catch (e) {
		logger.warn(
			{ userId, err: String(e) },
			"[userTier] userinfo lookup failed; failing open to paid"
		);
		entry = { kind: "error", expiresAt: Date.now() + ERROR_TTL_MS };
	}
	cache.set(userId, entry);
	ensureSweeper();
	return entry;
}

/**
 * Resolve whether the requesting user can pay for inference on the Hub.
 *
 * - Feature disabled (LLM_ROUTER_FREE_USER_MODEL empty): always "paid", no lookup.
 * - No logged-in user or no OAuth token: "free" — there is no account to bill.
 * - Hub lookup failure: "paid" (fail open) so a Hub blip never demotes a paying user.
 */
export async function resolveUserTier(locals: App.Locals | undefined): Promise<UserTier> {
	if (!getFreeUserModel()) return "paid";
	if (!locals?.user || !locals?.token) return "free";

	const entry = await getCacheEntry(locals.user._id.toString(), locals.token);
	if (entry.kind === "error") return "paid";

	// A selected billing org pays for the request (X-HF-Bill-To), so it counts as paid
	// even when the user's own account can't.
	const billingOrgPays = Boolean(
		locals.billingOrganization && entry.payingOrgs.includes(locals.billingOrganization)
	);
	return entry.isPro || entry.canPay || billingOrgPays ? "paid" : "free";
}

/**
 * Startup sanity checks for the free-tier routing configuration. Logs problems and never
 * throws — a misconfigured free tier must not take down normal routing.
 */
export function validateFreeTierRouterConfig(
	models: ReadonlyArray<{ id: string; name: string }>
): void {
	const freeUserModel = getFreeUserModel();
	if (!freeUserModel) return;

	if (!models.some((m) => m.id === freeUserModel || m.name === freeUserModel)) {
		logger.error(
			{ model: freeUserModel },
			"[userTier] configured free-tier model not found in model list"
		);
	}

	if (!(config.OPENID_SCOPES || "").split(/\s+/).includes("read-billing")) {
		logger.error(
			"[userTier] free-tier routing is enabled but OPENID_SCOPES lacks 'read-billing'; users with prepaid credits but no PRO subscription will be treated as free"
		);
	}
}
