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
	const pref = (typeof localStorage !== "undefined" ? (localStorage as any).theme : undefined) as
		| ThemePreference
		| undefined;
	return pref ?? "system";
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
	} catch {}

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
		[key: string]: ((this: MediaQueryList, ev: MediaQueryListEvent) => any) | undefined;
	};
	if (w[key]) {
		try {
			mql.removeEventListener("change", w[key]!);
		} catch {
			// older Safari
			// @ts-ignore
			mql.removeListener(w[key]!);
		}
		w[key] = undefined;
	}
	if (preference === "system") {
		try {
			mql.addEventListener("change", listener);
		} catch {
			// older Safari
			// @ts-ignore
			mql.addListener(listener);
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
