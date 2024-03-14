export function parseStringToList(links: unknown): string[] {
	if (typeof links !== "string") {
		return [];
	}

	return links
		.split(",")
		.map((link) => link.trim())
		.filter((link) => link.length > 0);
}
