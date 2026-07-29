/**
 * Format the numbered notes of an annotated screenshot into the text block
 * appended to the composer draft. Numbers match the badges baked into the
 * exported PNG, so the model can correlate each note with its marked area.
 */
export function formatScreenshotNotes(notes: readonly string[]): string | undefined {
	const cleaned = notes.map((note) => note.trim()).filter(Boolean);
	if (cleaned.length === 0) return undefined;
	return ["Screenshot notes:", ...cleaned.map((note, i) => `${i + 1}. ${note}`)].join("\n");
}
