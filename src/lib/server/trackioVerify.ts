import type { TrackioDashboard } from "$lib/utils/trackio";

const HUB = "https://huggingface.co";
/** `owner/name`, the only shape a Space id takes. */
const SPACE_ID = /^[A-Za-z0-9][\w.-]*\/[\w.-]+$/;
/** Org roles that can write to the org's Spaces. */
const WRITE_ROLES = new Set(["admin", "write", "contributor"]);

export type TrackioSpaceCheck = { ok: true; spaceId: string } | { ok: false; reason: string };

interface SpaceInfo {
	id?: string;
	author?: string;
	host?: string;
	tags?: string[];
}

interface WhoAmI {
	name?: string;
	orgs?: Array<{ name?: string; roleInOrg?: string }>;
}

async function hubJson<T>(path: string, token: string, signal?: AbortSignal): Promise<T | null> {
	const response = await fetch(`${HUB}${path}`, {
		headers: { Authorization: `Bearer ${token}` },
		signal,
	});
	if (!response.ok) return null;
	return (await response.json()) as T;
}

/**
 * The Space id a dashboard claims to be. A dashboard found as a Hub page link
 * carries it; one found as a bare `*.hf.space` URL does not, since subdomains
 * cannot be turned back into ids, so the Space is asked what it calls itself.
 * Either way this is only a candidate: `verifyTrackioSpace` accepts it only if
 * the Hub serves that Space at this exact origin.
 */
async function candidateSpaceId(
	dashboard: TrackioDashboard,
	signal?: AbortSignal
): Promise<string | undefined> {
	if (dashboard.spaceId && SPACE_ID.test(dashboard.spaceId)) return dashboard.spaceId;
	try {
		const response = await fetch(`${new URL(dashboard.url).origin}/api/get_settings`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: "{}",
			signal,
		});
		if (!response.ok) return undefined;
		const settings = (await response.json()) as { data?: { space_id?: unknown } };
		const id = settings.data?.space_id;
		return typeof id === "string" && SPACE_ID.test(id) ? id : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Whether a dashboard may be read with the user's Hub token: it must be a
 * Trackio Space, served at this exact origin, and owned by the user or by an
 * org they can write to. The token only ever goes to huggingface.co until this
 * passes, so a Space some job output merely named cannot collect it.
 */
export async function verifyTrackioSpace(
	dashboard: TrackioDashboard,
	token: string | undefined,
	signal?: AbortSignal
): Promise<TrackioSpaceCheck> {
	if (!token) return { ok: false, reason: "no Hugging Face login to check the Space against" };
	const spaceId = await candidateSpaceId(dashboard, signal);
	if (!spaceId) return { ok: false, reason: "could not tell which Space this dashboard is" };

	const [space, me] = await Promise.all([
		hubJson<SpaceInfo>(`/api/spaces/${spaceId}`, token, signal),
		hubJson<WhoAmI>("/api/whoami-v2", token, signal),
	]);
	if (!space) return { ok: false, reason: `the Hub has no Space ${spaceId} visible to this user` };
	if (!me?.name) return { ok: false, reason: "could not confirm the signed-in user" };

	let hostOrigin: string | undefined;
	try {
		hostOrigin = space.host ? new URL(space.host).origin : undefined;
	} catch {
		hostOrigin = undefined;
	}
	if (hostOrigin !== new URL(dashboard.url).origin) {
		return { ok: false, reason: `${spaceId} is not the Space served at ${dashboard.url}` };
	}
	if (!space.tags?.includes("trackio")) {
		return { ok: false, reason: `${spaceId} is not a Trackio Space` };
	}
	const owner = space.author ?? spaceId.split("/")[0];
	const canWrite =
		owner === me.name ||
		(me.orgs ?? []).some((org) => org.name === owner && WRITE_ROLES.has(org.roleInOrg ?? ""));
	if (!canWrite) {
		return {
			ok: false,
			reason: `${spaceId} belongs to ${owner}, which ${me.name} cannot write to`,
		};
	}
	return { ok: true, spaceId };
}
