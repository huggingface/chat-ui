/**
 * Incremental sentence extraction for streaming TTS.
 *
 * Voice mode feeds the assistant reply to text-to-speech while it is still
 * streaming. To keep latency low we synthesize sentence by sentence: as soon
 * as a sentence boundary appears in the stream, that sentence is handed to
 * the TTS queue while the model keeps generating.
 */

// Don't send micro-chunks ("Yes.") to TTS on their own unless the stream is
// done — batching them with the following sentence sounds more natural and
// halves the number of synthesis round-trips.
const MIN_CHUNK_LENGTH = 40;

// Never buffer forever when the model emits no punctuation (e.g. a long
// enumeration); cut at the last soft boundary once the buffer grows past this.
const MAX_CHUNK_LENGTH = 280;

const SENTENCE_END = /[.!?…]+(?=\s|$)|\n+/g;

/**
 * Extract speakable chunks from `text` starting at `offset`.
 * Returns the chunks and the new offset (index into `text` up to which
 * content has been consumed). When `flush` is true the remaining tail is
 * returned as a final chunk.
 */
export function extractSpeakableChunks(
	text: string,
	offset: number,
	flush = false
): { chunks: string[]; offset: number } {
	const chunks: string[] = [];
	let start = Math.min(offset, text.length);
	let searchFrom = start;

	// eslint-disable-next-line no-constant-condition
	while (true) {
		SENTENCE_END.lastIndex = searchFrom;
		const match = SENTENCE_END.exec(text);
		if (!match) break;

		const end = match.index + match[0].length;
		// A boundary only counts once we know what follows it (whitespace/end
		// already guaranteed by the regex). Guard against decimal numbers like
		// "3.5" splitting mid-number: the lookahead requires \s or end-of-text,
		// so nothing to do here.
		const candidate = text.slice(start, end);
		if (candidate.trim().length >= MIN_CHUNK_LENGTH) {
			chunks.push(candidate.trim());
			start = end;
		}
		searchFrom = end;
	}

	// Emergency cut for punctuation-less streams: break at the last space.
	if (text.length - start > MAX_CHUNK_LENGTH) {
		const tail = text.slice(start);
		const cut = tail.lastIndexOf(" ", MAX_CHUNK_LENGTH);
		if (cut > MIN_CHUNK_LENGTH) {
			chunks.push(tail.slice(0, cut).trim());
			start += cut + 1;
		}
	}

	if (flush) {
		const rest = text.slice(start).trim();
		if (rest.length > 0) {
			chunks.push(rest);
		}
		start = text.length;
	}

	return { chunks: chunks.filter((c) => c.length > 0), offset: start };
}

/**
 * Strip the markdown constructs a model may still emit despite the voice
 * prompt, so the TTS engine doesn't read "asterisk asterisk" aloud.
 */
export function cleanTextForSpeech(text: string): string {
	return (
		text
			// fenced code blocks are unreadable aloud
			.replace(/```[\s\S]*?(?:```|$)/g, " code omitted ")
			.replace(/`([^`]*)`/g, "$1")
			// images then links: keep the human-readable label
			.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
			.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
			// bold/italic/strikethrough markers
			.replace(/(\*\*|__|\*|_|~~)(\S(?:[\s\S]*?\S)?)\1/g, "$2")
			// headings and blockquote/list markers at line starts
			.replace(/^#{1,6}\s+/gm, "")
			.replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, "")
			.replace(/^\s*>\s?/gm, "")
			// tables and horizontal rules degrade to plain text
			.replace(/^\s*\|.*\|\s*$/gm, (row) => row.replace(/\|/g, " "))
			.replace(/^\s*([-*_]\s*){3,}$/gm, " ")
			// line breaks carry no meaning for speech
			.replace(/\s+/g, " ")
			.trim()
	);
}
