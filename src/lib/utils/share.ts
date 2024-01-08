export async function share(url: string, title: string) {
	if (navigator.share) {
		navigator.share({ url, title });
	} else {
		await navigator.clipboard.writeText(url);
	}
}
