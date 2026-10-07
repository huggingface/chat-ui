import type { TrackioDashboard } from "$lib/utils/trackio";

const HUB = "https://huggingface.co";
/** `owner/name`, the only shape a Space id takes. */
const SPACE_ID = /^[A-Za-z0-9][\w.-]*\/[\w.-]+$/;

/**
 * `bearer` is what the dashboard may be sent: nothing for a public Space, and
 * for a private one a JWT the Hub scopes to reading that Space alone. The
 * user's own token never leaves for the Space.
 */
export type TrackioSpaceCheck =
	{ ok: true; spaceId: string; bearer?: string } | { ok: false; reason: string };

interface SpaceInfo {
	host?: string;
	tags?: string[];
	private?: boolean;
}

async function hubJson<T>(
	path: string,
	token: string | undefined,
	signal?: AbortSignal
): Promise<T | null> {
	try {
		const response = await fetch(`${HUB}${path}`, {
			headers: token ? { Authorization: `Bearer ${token}` } : {},
			signal,
		});
		if (!response.ok) return null;
		return (await response.json()) as T;
	} catch {
		return null;
	}
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
 * Whether a dashboard may be read, and with what: it must be a Trackio Space
 * served at this exact origin. The user's token only ever goes to
 * huggingface.co, to see a private Space and to mint its read-only JWT.
 */
export async function verifyTrackioSpace(
	dashboard: TrackioDashboard,
	token: string | undefined,
	signal?: AbortSignal
): Promise<TrackioSpaceCheck> {
	const spaceId = await candidateSpaceId(dashboard, signal);
	if (!spaceId) return { ok: false, reason: "could not tell which Space this dashboard is" };

	const space = await hubJson<SpaceInfo>(`/api/spaces/${spaceId}`, token, signal);
	if (!space) return { ok: false, reason: `the Hub has no Space ${spaceId} visible to this user` };

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
	if (!space.private) return { ok: true, spaceId };

	const jwt = await hubJson<{ token?: unknown }>(`/api/spaces/${spaceId}/jwt`, token, signal);
	if (typeof jwt?.token !== "string" || !jwt.token) {
		return { ok: false, reason: `could not get read access to the private Space ${spaceId}` };
	}
	return { ok: true, spaceId, bearer: jwt.token };
}
