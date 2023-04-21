export function switchTheme() {
	const { classList } = document.querySelector("html") as HTMLElement;
	if (classList.contains("dark")) {
		classList.remove("dark");
		localStorage.theme = "light";
	} else {
		classList.add("dark");
		localStorage.theme = "dark";
	}
}
