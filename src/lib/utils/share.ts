export async function share(url: string, title: string) {
	if (navigator.share) {
		try {
			await navigator.share({ url, title: `Share this conversation: ${title}` });
		} catch (err) {
			// Probably an abort error, ignore
			console.error(err);
		}
	} else {
		prompt("Share this conversation:", url);
	}
}
