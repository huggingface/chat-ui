export async function share(url: string, title: string) {
	if (navigator.share) {
		try {
			await navigator.share({ url, title });
		} catch (err) {
			// Probably an abort error, ignore
			console.error(err);
		}
	} else {
		prompt("Copy this public url to share:", url);
	}
}
