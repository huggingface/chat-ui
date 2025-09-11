export type ThemePreference = "light" | "dark" | "system";

function setMetaThemeColor(isDark: boolean) {
	const metaTheme = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null;
	if (!metaTheme) return;
	metaTheme.setAttribute("content", isDark ? "rgb(26, 36, 50)" : "rgb(249, 250, 251)");
}

function applyDarkClass(isDark: boolean) {
	const { classList } = document.querySelector("html") as HTMLElement;
	if (isDark) classList.add("dark");
	else classList.remove("dark");
	setMetaThemeColor(isDark);
}

export function getThemePreference(): ThemePreference {
	const raw = typeof localStorage !== "undefined" ? localStorage.getItem("theme") : null;
	if (raw === "light" || raw === "dark" || raw === "system") return raw;
	return "system";
}

/**
 * Explicitly set the theme preference and apply it immediately.
 * - "light": force light
 * - "dark": force dark
 * - "system": follow the OS preference
 */
export function setTheme(preference: ThemePreference) {
	try {
		localStorage.theme = preference;
	} catch (_err) {
		void 0; // ignore write errors
	}

	const mql = window.matchMedia("(prefers-color-scheme: dark)");
	const resolve = () =>
		applyDarkClass(preference === "dark" || (preference === "system" && mql.matches));

	// Apply now
	resolve();

	// If following system, listen for changes; otherwise remove listener
	const listener = () => resolve();
	// Store on window to allow replacing listener later
	const key = "__theme_mql_listener" as const;
	const w = window as unknown as {
		[key: string]: ((this: MediaQueryList, ev: MediaQueryListEvent) => void) | undefined;
	};
	const existing = w[key];
	if (existing) {
		try {
			mql.removeEventListener("change", existing);
		} catch (_err) {
			// older Safari compatibility
			const legacy = (
				mql as unknown as {
					removeListener?: (l: (this: MediaQueryList, ev: MediaQueryListEvent) => void) => void;
				}
			).removeListener;
			legacy?.(existing);
		}
		w[key] = undefined;
	}
	if (preference === "system") {
		try {
			mql.addEventListener("change", listener);
		} catch (_err) {
			// older Safari compatibility
			const legacy = (
				mql as unknown as {
					addListener?: (l: (this: MediaQueryList, ev: MediaQueryListEvent) => void) => void;
				}
			).addListener;
			legacy?.(listener);
		}
		w[key] = listener;
	}
}

// Backward-compatible toggle used by the sidebar button
export function switchTheme() {
	const html = document.querySelector("html") as HTMLElement;
	const isDark = html.classList.contains("dark");
	const next: ThemePreference = isDark ? "light" : "dark";
	setTheme(next);
}
