import { browser } from "$app/environment";

// Loose absolute bounds for a resized width; the real visual bounds are
// proportional (each pane keeps at least 20% of the chat/panel split, see
// SidePane), so neither side can be dragged into oblivion.
export const SIDE_PANE_MIN_WIDTH = 300;
export const SIDE_PANE_MAX_WIDTH = 2400;
/** Default split when the user hasn't resized: the pane takes 60%, the chat keeps 40% */
export const SIDE_PANE_DEFAULT_FRACTION = "60%";

/** Which view owns the pane. One slot, so the views are mutually exclusive. */
export type SidePaneView = "artifact" | "trackio";

/**
 * UI state for the side pane. Its content is always derived from the
 * conversation messages — artifacts via `collectArtifacts`, Trackio dashboards
 * via `collectTrackioDashboards` — so this store only tracks what is showing
 * and how wide it is.
 *
 * The geometry (width, resize, open/close) is shared by every view; the fields
 * below it are still artifact-specific and would be worth splitting per view
 * once a second view needs state of its own.
 */
class SidePaneStore {
	open = $state(false);
	view = $state<SidePaneView>("artifact");
	/**
	 * The framed Trackio dashboard, when `view` is "trackio". `viewUrl` is a
	 * captured view to show instead of the dashboard's default one.
	 */
	trackio = $state<{ url: string; label: string; viewUrl?: string } | null>(null);
	identifier = $state<string | null>(null);
	/** 1-based version to display; null follows the latest version (including streaming growth) */
	version = $state<number | null>(null);
	tab = $state<"preview" | "code">("preview");
	/** Set when the user explicitly picked a tab, so we stop auto-switching */
	userPinnedTab = $state(false);
	/**
	 * Resized pixel width from a drag, or null to use the default 40/60 chat/panel split.
	 * Deliberately not persisted: a fresh load or a new conversation always
	 * starts at the default instead of restoring an earlier drag.
	 */
	widthPx = $state<number | null>(null);
	/** Word wrap in the code view (persisted) */
	codeWrap = $state(browser && localStorage.getItem("artifactPanelCodeWrap") === "true");
	/** Code tab shows the diff vs the previous version (edit versions only) */
	diffView = $state(true);
	/**
	 * Bumped on every explicit open so the panel re-anchors its scroll even
	 * when the target view didn't change (e.g. clicking the same card again
	 * after the view streamed pinned to the bottom).
	 */
	revealNonce = $state(0);

	toggleCodeWrap() {
		this.codeWrap = !this.codeWrap;
		if (browser) {
			localStorage.setItem("artifactPanelCodeWrap", String(this.codeWrap));
		}
	}

	toggleDiffView() {
		this.diffView = !this.diffView;
	}

	/** Versions we already auto-opened for, so closing the panel mid-stream sticks */
	private autoOpenedKeys = new Set<string>();

	openArtifact(identifier: string, version: number | null = null) {
		if (this.identifier !== identifier) {
			this.tab = "preview";
			this.userPinnedTab = false;
		}
		this.view = "artifact";
		this.identifier = identifier;
		this.version = version;
		this.open = true;
		this.revealNonce += 1;
	}

	/** Open once per streaming version; respects the user closing the panel mid-stream. */
	maybeAutoOpen(identifier: string, version: number) {
		const key = `${identifier}:${version}`;
		if (this.autoOpenedKeys.has(key)) return;
		this.autoOpenedKeys.add(key);
		this.openArtifact(identifier, null);
	}

	openTrackio(url: string, label: string, viewUrl?: string) {
		this.view = "trackio";
		this.trackio = { url, label, ...(viewUrl ? { viewUrl } : {}) };
		this.open = true;
		this.revealNonce += 1;
	}

	/**
	 * Open a dashboard the first time it appears, once per URL — a dashboard is
	 * live for the whole run, so re-opening it on every log poll would fight the
	 * user closing the pane to read the chat.
	 */
	maybeAutoOpenTrackio(url: string, label: string) {
		const key = `trackio:${url}`;
		if (this.autoOpenedKeys.has(key)) return;
		this.autoOpenedKeys.add(key);
		this.openTrackio(url, label);
	}

	selectTab(tab: "preview" | "code") {
		this.tab = tab;
		this.userPinnedTab = true;
	}

	setWidth(px: number) {
		this.widthPx = Math.min(SIDE_PANE_MAX_WIDTH, Math.max(SIDE_PANE_MIN_WIDTH, px));
	}

	/** Back to the default 40/60 chat/panel split */
	resetWidth() {
		this.widthPx = null;
	}

	close() {
		this.open = false;
	}

	/** Pane state per conversation left this tab, restored on the way back. */
	private saved = new Map<string, SavedPaneState>();

	/**
	 * Leaving one conversation for another: remember how the pane was in the
	 * one being left, then show the other as it was last left — or closed, for
	 * a conversation not visited yet. A restored item that no longer exists is
	 * closed by its view, the same way as after a branch switch.
	 */
	switchConversation(from: string | undefined, to: string | undefined) {
		if (from) {
			this.saved.set(from, {
				open: this.open,
				view: this.view,
				trackio: this.trackio,
				identifier: this.identifier,
				version: this.version,
				tab: this.tab,
				userPinnedTab: this.userPinnedTab,
				diffView: this.diffView,
				widthPx: this.widthPx,
				autoOpenedKeys: new Set(this.autoOpenedKeys),
			});
		}
		this.reset();
		const next = to ? this.saved.get(to) : undefined;
		if (!next) return;
		this.saved.delete(to as string);
		this.view = next.view;
		this.trackio = next.trackio;
		this.identifier = next.identifier;
		this.version = next.version;
		this.tab = next.tab;
		this.userPinnedTab = next.userPinnedTab;
		this.diffView = next.diffView;
		this.widthPx = next.widthPx;
		this.autoOpenedKeys = next.autoOpenedKeys;
		this.open = next.open;
	}

	/** Full reset: everything closed and forgotten for the current conversation. */
	reset() {
		this.open = false;
		this.view = "artifact";
		this.trackio = null;
		this.identifier = null;
		this.version = null;
		this.tab = "preview";
		this.userPinnedTab = false;
		this.diffView = true;
		this.widthPx = null;
		this.autoOpenedKeys.clear();
	}
}

interface SavedPaneState {
	open: boolean;
	view: SidePaneView;
	trackio: SidePaneStore["trackio"];
	identifier: string | null;
	version: number | null;
	tab: "preview" | "code";
	userPinnedTab: boolean;
	diffView: boolean;
	widthPx: number | null;
	autoOpenedKeys: Set<string>;
}

export const sidePane = new SidePaneStore();
