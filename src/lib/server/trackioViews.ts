import type { Message } from "$lib/types/Message";
import { collectTrackioDashboards } from "$lib/utils/trackio";
import {
	MAX_VIEWS_PER_MESSAGE,
	parseTrackioView,
	type TrackioDashboardView,
} from "$lib/utils/trackioView";

/**
 * `dashboardUrl` is what `read_trackio` later fetches from, so only dashboards
 * this conversation's own tool output produced are accepted.
 */
export function acceptTrackioViews(
	raw: unknown[] | undefined,
	messages: Array<Pick<Message, "id" | "from" | "updates">>
): TrackioDashboardView[] {
	if (!raw?.length) return [];
	const known = new Set(collectTrackioDashboards(messages).map((d) => d.url));
	const views: TrackioDashboardView[] = [];
	for (const item of raw.slice(0, MAX_VIEWS_PER_MESSAGE)) {
		const url = (item as { dashboardUrl?: unknown } | null)?.dashboardUrl;
		if (typeof url !== "string" || !known.has(url)) continue;
		const view = parseTrackioView(item, url);
		if (view) views.push(view);
	}
	return views;
}
