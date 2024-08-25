import { browser } from "$app/environment";

export async function share(url: string, title: string) {
	if (!browser) return;
	// Retrieve the leafId from localStorage
	const leafId = localStorage.getItem("leafId");
	if (leafId) {
		// Use URL and URLSearchParams to add the leafId parameter
		const shareUrl = new URL(url);
		shareUrl.searchParams.append("leafId", leafId);
		url = shareUrl.toString();
	}

	if (navigator.share) {
		navigator.share({ url, title });
	} else {
		alert("Please focus the document within 3 seconds by clicking somewhere or pressing Tab.");
		// Document Focus Error Handling
		setTimeout(async () => {
			if (document.hasFocus()) {
				await navigator.clipboard.writeText(url);
			} else {
				console.error("Document is not focused. Unable to write to clipboard.");
				alert("Document is not focused. Please try again.");
			}
		}, 3000); // 3-second delay to allow focusing
	}
}
