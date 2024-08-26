import { browser } from "$app/environment";

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

	if (navigator.share) {
		navigator.share({ url, title });
	} else {
		if (document.hasFocus()) {
			await navigator.clipboard.writeText(url);
		} else {
			alert("Document is not focused. Please try again.");
		}
	}
}
