import { browser } from "$app/environment";
import type { MlFileRef } from "$lib/types/MlFile";

// Loose absolute bounds for a resized width; the real visual bounds are
// proportional (each pane keeps at least 20% of the chat/panel split, see
// SidePane), so neither side can be dragged into oblivion.
export const SIDE_PANE_MIN_WIDTH = 300;
export const SIDE_PANE_MAX_WIDTH = 2400;
/** Default split when the user hasn't resized: the pane takes 60%, the chat keeps 40% */
export const SIDE_PANE_DEFAULT_FRACTION = "60%";
/**
 * Live views (framed Spaces, PDFs) stay mounted while their tab is in the
 * background so switching back keeps their state. Past this many, the least
 * recently shown one is unmounted and reloads when it is picked again.
 */
export const KEEP_ALIVE_LIMIT = 5;

export type SidePaneView = "artifact" | "trackio" | "workflow" | "registry" | "review" | "paper";

/** Where a paper tab should scroll to: a page, and optionally a passage on it to flash. */
export interface PaperTarget {
	page: number;
	quote?: string;
	/** bumped per request, so asking for the same passage twice flashes it twice */
	nonce: number;
}

export type PaneTab =
	| {
			id: string;
			kind: "artifact";
			identifier: string;
			/** 1-based version to display; null follows the latest version (including streaming growth) */
			version: number | null;
			tab: "preview" | "code";
			/** Set when the user explicitly picked preview/code, so we stop auto-switching */
			userPinnedTab: boolean;
	  }
	| { id: string; kind: "trackio"; url: string; label: string; viewUrl?: string }
	| { id: string; kind: "workflow"; url: string; label: string; spaceId: string }
	| { id: string; kind: "registry"; focus: MlFileRef | null }
	| { id: string; kind: "review"; reviewId: string }
	| {
			id: string;
			kind: "paper";
			paperId: string;
			label: string;
			target: PaperTarget | null;
			/**
			 * Where the reader was, kept on the tab so hiding the pane (which
			 * unmounts the reader) or reloading it does not lose the place.
			 */
			reading?: { page: number; fraction: number; zoom: number };
			/** the last target the reader went to, so a remount does not jump back to it */
			seenNonce?: number;
	  };

export type PaneTabOf<K extends PaneTab["kind"]> = Extract<PaneTab, { kind: K }>;
type NewTab = PaneTab extends infer T ? (T extends PaneTab ? Omit<T, "id"> : never) : never;

/** Views whose content is a live document worth keeping mounted in the background. */
export function isKeepAliveTab(tab: PaneTab): tab is PaneTabOf<"trackio" | "workflow" | "paper"> {
	return tab.kind === "trackio" || tab.kind === "workflow" || tab.kind === "paper";
}

/** One tab per thing: opening something already open focuses its tab. */
export function paneTabId(tab: NewTab | PaneTab): string {
	switch (tab.kind) {
		case "artifact":
			return `artifact:${tab.identifier}`;
		case "trackio":
			return `trackio:${tab.url}`;
		case "workflow":
			return `workflow:${tab.url}`;
		case "registry":
			return "registry";
		case "review":
			return `review:${tab.reviewId}`;
		case "paper":
			return `paper:${tab.paperId}`;
	}
}

/**
 * UI state for the side pane: the tabs that are open, which one is showing,
 * and the pane's geometry. What a tab shows is always derived from the
 * conversation messages (artifacts via `collectArtifacts`, dashboards via
 * `collectTrackioDashboards`, papers via `collectPapers`), so a tab only holds
 * the key to find its content plus that view's own UI state.
 *
 * The single-view getters (`view`, `identifier`, `trackio`, ...) describe the
 * active tab, so code that only cares about "what is showing" reads as before.
 */
class SidePaneStore {
	open = $state(false);
	tabs = $state<PaneTab[]>([]);
	activeId = $state<string | null>(null);
	/** most recently shown first; decides which background tabs stay mounted */
	recent = $state<string[]>([]);
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
	/** Views holding Escape for something more urgent (a modal, an in-flight generation). */
	private escapeHolders = $state<string[]>([]);

	get escapeBlocked(): boolean {
		return this.escapeHolders.length > 0;
	}

	holdEscape(holder: string, held: boolean) {
		const has = this.escapeHolders.includes(holder);
		if (held && !has) this.escapeHolders = [...this.escapeHolders, holder];
		else if (!held && has) this.escapeHolders = this.escapeHolders.filter((h) => h !== holder);
	}

	get active(): PaneTab | undefined {
		return this.tabs.find((tab) => tab.id === this.activeId);
	}

	private activeOf<K extends PaneTab["kind"]>(kind: K): PaneTabOf<K> | undefined {
		const tab = this.active;
		return tab?.kind === kind ? (tab as PaneTabOf<K>) : undefined;
	}

	/** Which kind of view is showing. */
	get view(): SidePaneView {
		return this.active?.kind ?? "artifact";
	}

	get identifier(): string | null {
		return this.activeOf("artifact")?.identifier ?? null;
	}

	get version(): number | null {
		return this.activeOf("artifact")?.version ?? null;
	}

	set version(version: number | null) {
		const tab = this.activeOf("artifact");
		if (tab) tab.version = version;
	}

	get tab(): "preview" | "code" {
		return this.activeOf("artifact")?.tab ?? "preview";
	}

	get userPinnedTab(): boolean {
		return this.activeOf("artifact")?.userPinnedTab ?? false;
	}

	/** `viewUrl` is a captured view to show instead of the dashboard's default. */
	get trackio(): { url: string; label: string; viewUrl?: string } | null {
		const tab = this.activeOf("trackio");
		if (!tab) return null;
		return { url: tab.url, label: tab.label, ...(tab.viewUrl ? { viewUrl: tab.viewUrl } : {}) };
	}

	get workflow(): { url: string; label: string; spaceId: string } | null {
		const tab = this.activeOf("workflow");
		return tab ? { url: tab.url, label: tab.label, spaceId: tab.spaceId } : null;
	}

	/** the file version the registry view scrolls to and opens */
	get registryFocus(): MlFileRef | null {
		return this.activeOf("registry")?.focus ?? null;
	}

	get reviewId(): string | null {
		return this.activeOf("review")?.reviewId ?? null;
	}

	/** Whether this tab is open, whether or not it is the one showing. */
	hasTab(id: string): boolean {
		return this.tabs.some((tab) => tab.id === id);
	}

	/**
	 * Add the tab, or update and focus it when it is already open. `focus: false`
	 * opens it in the background (the pane itself still has to be open to show it).
	 */
	private openTab(next: NewTab, { focus = true }: { focus?: boolean } = {}) {
		const id = paneTabId(next);
		const index = this.tabs.findIndex((tab) => tab.id === id);
		if (index === -1) {
			// beside the one showing, like a browser opening a link in a new tab
			const at = this.tabs.findIndex((t) => t.id === this.activeId);
			const tabs = [...this.tabs];
			tabs.splice(at === -1 ? tabs.length : at + 1, 0, { ...next, id } as PaneTab);
			this.tabs = tabs;
		} else {
			Object.assign(this.tabs[index], next);
		}
		if (focus || !this.activeId || !this.open) this.activate(id);
		else this.recent = [...this.recent.filter((r) => r !== id), id];
	}

	/** Show an open tab. */
	activate(id: string) {
		if (!this.hasTab(id)) return;
		this.activeId = id;
		this.recent = [id, ...this.recent.filter((r) => r !== id)];
		this.open = true;
		this.revealNonce += 1;
	}

	/** Close one tab; the pane closes with its last tab. */
	closeTab(id: string) {
		const index = this.tabs.findIndex((tab) => tab.id === id);
		if (index === -1) return;
		this.tabs = this.tabs.filter((tab) => tab.id !== id);
		this.recent = this.recent.filter((r) => r !== id);
		if (this.activeId === id) {
			// the most recently shown one, else the neighbour
			const next =
				this.recent.find((r) => this.hasTab(r)) ??
				this.tabs[Math.min(index, this.tabs.length - 1)]?.id ??
				null;
			this.activeId = next;
			if (next) this.recent = [next, ...this.recent.filter((r) => r !== next)];
		}
		if (this.tabs.length === 0) this.open = false;
	}

	/** Live views that stay mounted: the active one plus the most recently shown few. */
	get mountedKeepAlive(): PaneTab[] {
		const keep = new Set(
			this.recent
				.filter((id) => {
					const tab = this.tabs.find((t) => t.id === id);
					return tab !== undefined && isKeepAliveTab(tab);
				})
				.slice(0, KEEP_ALIVE_LIMIT)
		);
		if (this.activeId) keep.add(this.activeId);
		return this.tabs.filter((tab) => isKeepAliveTab(tab) && keep.has(tab.id));
	}

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
		const existing = this.tabs.find((t) => t.id === `artifact:${identifier}`);
		this.openTab({
			kind: "artifact",
			identifier,
			version,
			tab: existing?.kind === "artifact" ? existing.tab : "preview",
			userPinnedTab: existing?.kind === "artifact" ? existing.userPinnedTab : false,
		});
	}

	/** Open once per streaming version; respects the user closing the panel mid-stream. */
	maybeAutoOpen(identifier: string, version: number) {
		const key = `${identifier}:${version}`;
		if (this.autoOpenedKeys.has(key)) return;
		this.autoOpenedKeys.add(key);
		this.openArtifact(identifier, null);
	}

	openTrackio(url: string, label: string, viewUrl?: string) {
		this.openTab({ kind: "trackio", url, label, viewUrl });
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

	openWorkflow(
		workflow: { url: string; label: string; spaceId: string },
		opts: { focus?: boolean } = {}
	) {
		this.openTab(
			{ kind: "workflow", url: workflow.url, label: workflow.label, spaceId: workflow.spaceId },
			opts
		);
	}

	/** Never takes the pane from another view: opens in the background when something else shows. */
	maybeAutoOpenWorkflow(workflow: { url: string; label: string; spaceId: string }) {
		const key = `workflow:${workflow.url}`;
		if (this.autoOpenedKeys.has(key)) return;
		this.autoOpenedKeys.add(key);
		this.openWorkflow(workflow, { focus: !(this.open && this.view !== "workflow") });
	}

	/** a list, not an item, so it has no place in the item list */
	openRegistry(focus: MlFileRef | null = null) {
		this.openTab({
			kind: "registry",
			focus: focus && { name: focus.name, version: focus.version },
		});
	}

	openReview(reviewId: string) {
		this.openTab({ kind: "review", reviewId });
	}

	/**
	 * Open a paper, optionally at a page and passage. Without a target an open
	 * tab keeps its own scroll position, so reopening a paper resumes reading.
	 */
	openPaper(
		paperId: string,
		label: string,
		target?: { page: number; quote?: string },
		{ focus = true }: { focus?: boolean } = {}
	) {
		const existing = this.tabs.find((t) => t.id === `paper:${paperId}`);
		const previous = existing?.kind === "paper" ? existing.target : null;
		this.openTab(
			{
				kind: "paper",
				paperId,
				label,
				target: target ? { ...target, nonce: (previous?.nonce ?? 0) + 1 } : previous,
			},
			{ focus }
		);
	}

	/**
	 * Open a paper the first time it appears; a closed tab stays closed. Like a
	 * workflow, it never takes over another view: with one showing, the paper
	 * opens as a background tab.
	 */
	maybeAutoOpenPaper(paperId: string, label: string) {
		const key = `paper:${paperId}`;
		if (this.autoOpenedKeys.has(key)) return;
		this.autoOpenedKeys.add(key);
		this.openPaper(paperId, label, undefined, { focus: !(this.open && this.view !== "paper") });
	}

	selectTab(tab: "preview" | "code") {
		const active = this.activeOf("artifact");
		if (!active) return;
		active.tab = tab;
		active.userPinnedTab = true;
	}

	setWidth(px: number) {
		this.widthPx = Math.min(SIDE_PANE_MAX_WIDTH, Math.max(SIDE_PANE_MIN_WIDTH, px));
	}

	/** Back to the default 40/60 chat/panel split */
	resetWidth() {
		this.widthPx = null;
	}

	/** Hide the pane; its tabs stay, so reopening it brings them back. */
	close() {
		this.open = false;
	}

	private saved = new Map<string, SavedPaneState>();
	private static readonly MAX_SAVED = 20;

	/**
	 * A restored item that no longer exists is closed by its view, the same way
	 * as after a branch switch.
	 */
	switchConversation(from: string | undefined, to: string | undefined) {
		if (from) {
			this.saved.set(from, {
				open: this.open,
				tabs: $state.snapshot(this.tabs) as PaneTab[],
				activeId: this.activeId,
				recent: [...this.recent],
				diffView: this.diffView,
				widthPx: this.widthPx,
				autoOpenedKeys: new Set(this.autoOpenedKeys),
			});
			// Maps iterate oldest first.
			for (const id of this.saved.keys()) {
				if (this.saved.size <= SidePaneStore.MAX_SAVED) break;
				this.saved.delete(id);
			}
		}
		this.reset();
		const next = to ? this.saved.get(to) : undefined;
		if (!next) return;
		this.saved.delete(to as string);
		this.tabs = next.tabs;
		this.activeId = next.activeId;
		this.recent = next.recent;
		this.diffView = next.diffView;
		this.widthPx = next.widthPx;
		this.autoOpenedKeys = next.autoOpenedKeys;
		this.open = next.open && next.tabs.length > 0;
	}

	reset() {
		this.open = false;
		this.tabs = [];
		this.activeId = null;
		this.recent = [];
		this.diffView = true;
		this.widthPx = null;
		this.escapeHolders = [];
		this.autoOpenedKeys.clear();
	}
}

interface SavedPaneState {
	open: boolean;
	tabs: PaneTab[];
	activeId: string | null;
	recent: string[];
	diffView: boolean;
	widthPx: number | null;
	autoOpenedKeys: Set<string>;
}

export const sidePane = new SidePaneStore();
