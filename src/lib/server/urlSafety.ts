// Shared server-side URL safety helper (exact behavior preserved)
export function isValidUrl(urlString: string): boolean {
	try {
		const url = new URL(urlString.trim());
		// Only allow HTTPS protocol
		if (url.protocol !== "https:") {
			return false;
		}
		// Prevent localhost/private IPs (basic check)
		const hostname = url.hostname.toLowerCase();
		if (
			hostname === "localhost" ||
			hostname.startsWith("127.") ||
			hostname.startsWith("192.168.") ||
			hostname.startsWith("172.16.") ||
			hostname === "[::1]" ||
			hostname === "0.0.0.0"
		) {
			return false;
		}
		return true;
	} catch {
		return false;
	}
}
