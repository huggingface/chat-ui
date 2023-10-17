export function switchTheme() {
	const { classList } = document.querySelector("html") as HTMLElement;
	const metaTheme = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement;

	if (classList.contains("dark")) {
		classList.remove("dark");
		metaTheme.setAttribute("content", "rgb(249, 250, 251)");
		localStorage.theme = "light";
	} else {
		classList.add("dark");
		metaTheme.setAttribute("content", "rgb(26, 36, 50)");
		localStorage.theme = "dark";
	}
}
