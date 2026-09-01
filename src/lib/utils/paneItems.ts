import type { Message } from "$lib/types/Message";
import type { ArtifactRegistry } from "./artifacts";
import type { TrackioDashboard } from "./trackio";

/**
 * Everything the side pane can show for one conversation, as a single ordered
 * list the user can page through: artifacts, Trackio dashboards, and whatever
 * embeddable thing comes next.
 *
 * There is one pane and one axis. An artifact contributes ONE item however many
 * versions it has — versions are their own axis inside the artifact view, and
 * folding them in here would let a five-version artifact bury a training run.
 *
 * Derived from the same message walk everything else uses (`collectArtifacts`,
 * `collectTrackioDashboards`), so nothing is stored and reopening a
 * conversation rebuilds the same list in the same order.
 */

export type PaneItem =
	| { kind: "artifact"; identifier: string; label: string }
	| { kind: "trackio"; url: string; label: string };

/** The pane's current selection, as the store holds it. */
export interface PaneSelection {
	view: "artifact" | "trackio";
	identifier: string | null;
	trackioUrl?: string;
}

/**
 * Items in conversation order: by the message they first appeared in, and
 * within a message dashboards before artifacts — a turn that runs a job and
 * then writes about it produces its tool output before its prose.
 *
 * Anything whose message is no longer on the visible path (branch switch,
 * message edit) drops out, which is what lets the views notice their target is
 * gone.
 */
export function collectPaneItems(
	messages: Array<Pick<Message, "id">>,
	registry: ArtifactRegistry,
	dashboards: TrackioDashboard[]
): PaneItem[] {
	const position = new Map<Message["id"], number>();
	messages.forEach((message, index) => position.set(message.id, index));

	// `Infinity` keeps an item whose message we cannot place at the end rather
	// than silently promoting it to the front.
	const at = (messageId: Message["id"] | undefined) =>
		messageId === undefined ? Infinity : (position.get(messageId) ?? Infinity);

	type Entry = { item: PaneItem; message: number; withinMessage: number };
	const entries: Entry[] = [];

	for (const dashboard of dashboards) {
		entries.push({
			item: { kind: "trackio", url: dashboard.url, label: dashboard.label },
			message: at(dashboard.messageId),
			withinMessage: 0,
		});
	}

	for (const artifact of registry.artifacts.values()) {
		const first = artifact.versions[0];
		if (!first) continue;
		entries.push({
			item: {
				kind: "artifact",
				identifier: artifact.identifier,
				// The latest title, not the first: a rewrite can rename an artifact,
				// and the nav should agree with what the header shows.
				label: artifact.versions[artifact.versions.length - 1].title,
			},
			message: at(first.messageId),
			withinMessage: 1,
		});
	}

	// Stable within a (message, kind) bucket: `sort` is stable in every engine we
	// target, so same-message artifacts keep registry insertion order and
	// same-message dashboards keep the order they were printed in.
	entries.sort((a, b) => a.message - b.message || a.withinMessage - b.withinMessage);
	return entries.map((entry) => entry.item);
}

/** Whether an item is the one the pane is currently showing. */
export function isPaneItemSelected(item: PaneItem, selection: PaneSelection): boolean {
	return item.kind === "artifact"
		? selection.view === "artifact" && selection.identifier === item.identifier
		: selection.view === "trackio" && selection.trackioUrl === item.url;
}

/** Index of the selected item, or -1 when the selection is not in the list. */
export function findPaneItemIndex(items: PaneItem[], selection: PaneSelection): number {
	return items.findIndex((item) => isPaneItemSelected(item, selection));
}
