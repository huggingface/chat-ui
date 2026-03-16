/**
 * Split text into chunks of approximately `chunkSize` characters with `overlap` character overlap.
 * Tries to split on paragraph or sentence boundaries when possible.
 */
export function chunkText(text: string, chunkSize: number, overlap: number): string[] {
	if (!text || text.length <= chunkSize) {
		return text ? [text] : [];
	}

	const chunks: string[] = [];
	let start = 0;

	while (start < text.length) {
		let end = Math.min(start + chunkSize, text.length);

		// If not at the end, try to find a good break point
		if (end < text.length) {
			// Look for paragraph break first (within last 20% of chunk)
			const searchStart = start + Math.floor(chunkSize * 0.8);
			const paragraphBreak = text.lastIndexOf("\n\n", end);
			if (paragraphBreak > searchStart) {
				end = paragraphBreak + 2;
			} else {
				// Try sentence break
				const sentenceBreak = text.lastIndexOf(". ", end);
				if (sentenceBreak > searchStart) {
					end = sentenceBreak + 2;
				}
			}
		}

		chunks.push(text.slice(start, end).trim());

		// Move start forward, accounting for overlap
		start = end - overlap;
		if (start >= text.length) break;
	}

	return chunks.filter((c) => c.length > 0);
}
