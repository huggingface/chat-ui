import { logger } from "$lib/server/logger";

/** Hub runtime stages that mean the dashboard can be framed. */
const LIVE_STAGES = new Set(["RUNNING", "RUNNING_APP_STARTING", "RUNNING_BUILDING"]);
/** Stages from which it will never become live without someone intervening. */
const DEAD_STAGES = new Set(["BUILD_ERROR", "RUNTIME_ERROR", "CONFIG_ERROR", "PAUSED", "STOPPED"]);

export type TrackioSpaceStatus = "missing" | "building" | "live" | "failed";

/**
 * Space names must be unique per project and stable across a conversation, so
 * the dashboard a chip points at is the one the run writes to. Derived from the
 * project rather than random: a rerun of the same project reuses its Space,
 * which is what makes "found existing space" the fast path.
 */
export function trackioSpaceId(namespace: string, project: string): string {
	const slug = project
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 80);
	return `${namespace}/${slug || "trackio"}-trackio`;
}

/**
 * Provisioned by trackio itself, not by writing the Space files here.
 *
 * A Space whose layout or trackio version is subtly wrong answers `init`
 * normally and then refuses every write — the Space 500s on /api/bulk_log and
 * the bucket 403s on its write token, and a whole run's metrics end up on the
 * job's ephemeral disk. Letting trackio's own deploy path build it is what
 * keeps the layout and the version right by construction.
 */
export function trackioProvisionScript(spaceId: string, project: string): string {
	return [
		"import trackio",
		`trackio.init(project=${JSON.stringify(project)}, space_id=${JSON.stringify(spaceId)}, name="provision")`,
		"trackio.finish()",
		'print("PROVISIONED", flush=True)',
	].join("\n");
}

interface SpaceRuntime {
	runtime?: { stage?: string };
}

/**
 * The Space's stage, straight from the Hub.
 *
 * Read server-side: the token stays here, and a cross-origin fetch of the
 * Space itself cannot tell "still building" from "blocked by CORS" anyway.
 */
export async function fetchTrackioSpaceStatus(
	spaceId: string,
	token?: string
): Promise<TrackioSpaceStatus> {
	try {
		const response = await fetch(`https://huggingface.co/api/spaces/${spaceId}`, {
			headers: token ? { Authorization: `Bearer ${token}` } : {},
		});
		if (response.status === 404) return "missing";
		if (!response.ok) {
			logger.warn({ spaceId, status: response.status }, "[trackio] space status lookup failed");
			return "building";
		}
		const stage = ((await response.json()) as SpaceRuntime).runtime?.stage ?? "";
		if (LIVE_STAGES.has(stage)) return "live";
		if (DEAD_STAGES.has(stage)) return "failed";
		return "building";
	} catch (err) {
		// A lookup that failed is not a Space that failed; the caller polls again.
		logger.warn({ err, spaceId }, "[trackio] space status lookup threw");
		return "building";
	}
}
