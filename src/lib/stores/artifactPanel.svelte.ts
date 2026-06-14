import { browser } from "$app/environment";

// Loose absolute bounds for a resized width; the real visual bounds are
// proportional (each pane keeps at least 20% of the chat/panel split, see
// ArtifactPanel), so neither side can be dragged into oblivion.
export const ARTIFACT_PANEL_MIN_WIDTH = 300;
export const ARTIFACT_PANEL_MAX_WIDTH = 2400;
/** Default split when the user hasn't resized: the panel and chat each take half */
export const ARTIFACT_PANEL_DEFAULT_FRACTION = "50%";

/**
 * UI state for the artifact side panel. Artifact content itself is derived
 * from the conversation messages (see `collectArtifacts`); this store only
 * tracks what the panel is showing.
 */
class ArtifactPanelStore {
	open = $state(false);
	identifier = $state<string | null>(null);
	/** 1-based version to display; null follows the latest version (including streaming growth) */
	version = $state<number | null>(null);
	tab = $state<"preview" | "code">("preview");
	/** Set when the user explicitly picked a tab, so we stop auto-switching */
	userPinnedTab = $state(false);
	/**
	 * Resized pixel width from a drag, or null to use the default 50/50 split.
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

	selectTab(tab: "preview" | "code") {
		this.tab = tab;
		this.userPinnedTab = true;
	}

	setWidth(px: number) {
		this.widthPx = Math.min(ARTIFACT_PANEL_MAX_WIDTH, Math.max(ARTIFACT_PANEL_MIN_WIDTH, px));
	}

	/** Back to the default 50/50 split */
	resetWidth() {
		this.widthPx = null;
	}

	close() {
		this.open = false;
	}

	/** Full reset, used when switching conversations. */
	reset() {
		this.open = false;
		this.identifier = null;
		this.version = null;
		this.tab = "preview";
		this.userPinnedTab = false;
		this.diffView = true;
		this.widthPx = null;
		this.autoOpenedKeys.clear();
	}
}

export const artifactPanel = new ArtifactPanelStore();
