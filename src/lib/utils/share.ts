export async function share(url: string, title: string) {
	if (typeof window === "undefined") return;

	// Retrieve the leafId from localStorage
	let leafId = localStorage.getItem("leafId");
	if (leafId) {
		// Use URL and URLSearchParams to add the leafId parameter
		const shareUrl = new URL(url);
		shareUrl.searchParams.append("leafId", leafId);
		url = shareUrl.toString();
	}

	if (navigator.share) {
		navigator.share({ url, title });
	} else {
		await navigator.clipboard.writeText(url);
	}
}
