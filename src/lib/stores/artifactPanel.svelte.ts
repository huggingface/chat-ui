import { browser } from "$app/environment";

const WIDTH_STORAGE_KEY = "artifactPanelWidth";
// Loose absolute bounds for the persisted value; the real visual bounds are
// proportional (each pane keeps at least 20% of the chat/panel split, see
// ArtifactPanel), so neither side can be dragged into oblivion.
export const ARTIFACT_PANEL_MIN_WIDTH = 300;
export const ARTIFACT_PANEL_MAX_WIDTH = 2400;
export const ARTIFACT_PANEL_DEFAULT_WIDTH = 560;

function initialWidth(): number {
	if (browser) {
		const stored = Number(localStorage.getItem(WIDTH_STORAGE_KEY));
		if (Number.isFinite(stored) && stored >= ARTIFACT_PANEL_MIN_WIDTH) {
			return Math.min(stored, ARTIFACT_PANEL_MAX_WIDTH);
		}
	}
	return ARTIFACT_PANEL_DEFAULT_WIDTH;
}

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
	widthPx = $state(initialWidth());

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
		if (browser) {
			localStorage.setItem(WIDTH_STORAGE_KEY, String(Math.round(this.widthPx)));
		}
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
		this.autoOpenedKeys.clear();
	}
}

export const artifactPanel = new ArtifactPanelStore();
