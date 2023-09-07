export function share(url: string, title: string) {
	if (navigator.share) {
		navigator.share({ url, title });
	} else {
		prompt("Copy this public url to share:", url);
	}
}
