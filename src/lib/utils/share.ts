import { browser } from "$app/environment";
import { isDesktop } from "./isDesktop";

export async function share(url: string, title: string, appendLeafId: boolean = false) {
	if (!browser) return;

	// Retrieve the leafId from localStorage
	const leafId = localStorage.getItem("leafId");

	if (appendLeafId && leafId) {
		// Use URL and URLSearchParams to add the leafId parameter
		const shareUrl = new URL(url);
		shareUrl.searchParams.append("leafId", leafId);
		url = shareUrl.toString();
	}

	if (navigator.share && !isDesktop(window)) {
		navigator.share({ url, title });
	} else {
		// this is really ugly
		// but on chrome the clipboard write doesn't work if the window isn't focused
		// and after we use confirm() to ask the user if they want to share, the window is no longer focused
		// for a few ms until the confirm dialog closes. tried await tick(), tried window.focus(), didnt work
		// bug doesnt occur in firefox, if you can find a better fix for it please do
		await new Promise((resolve) => setTimeout(resolve, 250));
		await navigator.clipboard.writeText(url);
	}
}
