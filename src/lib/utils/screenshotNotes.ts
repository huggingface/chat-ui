/**
 * Format the numbered notes of an annotated screenshot into the text block
 * appended to the composer draft. Numbers match the badges baked into the
 * exported PNG, so the model can correlate each note with its marked area.
 *
 * `subject` names the screenshot in the header (e.g. `"Pomodoro Timer" (v2)`):
 * a draft can carry blocks from several annotated screenshots, whose badge
 * numbering each restarts at 1, so the headers are what keeps them apart.
 */
export function formatScreenshotNotes(
	notes: readonly string[],
	subject?: string
): string | undefined {
	const cleaned = notes.map((note) => note.trim()).filter(Boolean);
	if (cleaned.length === 0) return undefined;
	// "numbered marks" states the number-to-image correspondence in two words:
	// without it models tend to infer the referent from conversation context
	// instead of locating the marker on the image
	return [
		subject ? `${subject} screenshot with numbered marks:` : "Screenshot with numbered marks:",
		// Continuation lines of a multiline note are indented so the numbering
		// stays scannable
		...cleaned.map((note, i) => `${i + 1}. ${note.replace(/\s*\n\s*/g, "\n   ")}`),
	].join("\n");
}
