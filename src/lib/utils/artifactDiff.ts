/**
 * Line diff between two artifact versions, used by the artifact panel to show
 * what an `update` operation changed.
 *
 * The whole file is emitted (changed lines marked, unchanged lines as
 * context), not just hunks: the code view stays a scrollable view of the
 * artifact, and the panel auto-scrolls to the first change. Rendering keeps
 * full syntax highlighting: the old and new contents are highlighted
 * separately, split into lines, and changed lines are tinted via
 * background-only classes so token colors stay intact (plus a stronger
 * emphasis chip on the changed segment of replaced lines).
 */

export type DiffLineType = "context" | "add" | "del";

export interface DiffLine {
	type: DiffLineType;
	text: string;
}

/**
 * Beyond this many LCS cells, fall back to a plain delete-all/add-all block
 * for the changed region instead of computing an optimal alignment.
 */
const MAX_LCS_CELLS = 1_000_000;

/**
 * Diff `oldText` → `newText` line by line. Common prefix/suffix lines are
 * trimmed first — artifact updates are typically small and local, which keeps
 * the LCS table tiny even for large artifacts. Within a changed region,
 * deletions are emitted before additions.
 */
export function diffLines(oldText: string, newText: string): DiffLine[] {
	// A trailing newline is presentation, not content — don't diff it
	const a = oldText.replace(/\n$/, "").split("\n");
	const b = newText.replace(/\n$/, "").split("\n");

	let start = 0;
	while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
	let endA = a.length;
	let endB = b.length;
	while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
		endA -= 1;
		endB -= 1;
	}

	const lines: DiffLine[] = [];
	for (let i = 0; i < start; i += 1) lines.push({ type: "context", text: a[i] });

	const n = endA - start;
	const m = endB - start;
	if (n > 0 && m > 0 && (n + 1) * (m + 1) <= MAX_LCS_CELLS) {
		// dp[i][j] = LCS length of a[start+i..endA) and b[start+j..endB), so the
		// walk below can emit lines forward in display order.
		const width = m + 1;
		const dp = new Uint32Array((n + 1) * width);
		for (let i = n - 1; i >= 0; i -= 1) {
			for (let j = m - 1; j >= 0; j -= 1) {
				dp[i * width + j] =
					a[start + i] === b[start + j]
						? dp[(i + 1) * width + j + 1] + 1
						: Math.max(dp[(i + 1) * width + j], dp[i * width + j + 1]);
			}
		}
		let i = 0;
		let j = 0;
		while (i < n && j < m) {
			if (a[start + i] === b[start + j]) {
				lines.push({ type: "context", text: a[start + i] });
				i += 1;
				j += 1;
			} else if (dp[(i + 1) * width + j] >= dp[i * width + j + 1]) {
				lines.push({ type: "del", text: a[start + i] });
				i += 1;
			} else {
				lines.push({ type: "add", text: b[start + j] });
				j += 1;
			}
		}
		while (i < n) {
			lines.push({ type: "del", text: a[start + i] });
			i += 1;
		}
		while (j < m) {
			lines.push({ type: "add", text: b[start + j] });
			j += 1;
		}
	} else {
		for (let i = start; i < endA; i += 1) lines.push({ type: "del", text: a[i] });
		for (let j = start; j < endB; j += 1) lines.push({ type: "add", text: b[j] });
	}

	for (let i = endA; i < a.length; i += 1) lines.push({ type: "context", text: a[i] });
	return lines;
}

export function diffStats(lines: DiffLine[]): { added: number; removed: number } {
	let added = 0;
	let removed = 0;
	for (const line of lines) {
		if (line.type === "add") added += 1;
		else if (line.type === "del") removed += 1;
	}
	return { added, removed };
}

// ---------- rendering ----------

function escapeHtml(text: string): string {
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Split highlighter output into one HTML string per line. hljs emits flat
 * escaped text plus `<span>` tokens that may legally span newlines (template
 * literals, comments), so open spans are closed at each line break and
 * reopened on the next line — every returned line is self-contained HTML.
 */
function splitHighlightedLines(html: string): string[] {
	const lines: string[] = [];
	const stack: string[] = [];
	let current = "";
	const tokens = html.match(/<\/?span[^>]*>|\n|[^\n<]+|</g) ?? [];
	for (const token of tokens) {
		if (token === "\n") {
			lines.push(current + "</span>".repeat(stack.length));
			current = stack.join("");
		} else if (token.startsWith("<span")) {
			stack.push(token);
			current += token;
		} else if (token.startsWith("</")) {
			stack.pop();
			current += token;
		} else {
			current += token;
		}
	}
	lines.push(current);
	return lines;
}

interface CharRange {
	start: number;
	end: number;
}

/**
 * Common prefix/suffix trim between a replaced line pair, yielding the
 * changed segment on each side. Returns null when the lines share too little
 * for an emphasis chip to mean anything (the whole-line tint is enough).
 */
function changedSegments(a: string, b: string): { a: CharRange; b: CharRange } | null {
	const max = Math.min(a.length, b.length);
	let prefix = 0;
	while (prefix < max && a[prefix] === b[prefix]) prefix += 1;
	let suffix = 0;
	while (suffix < max - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) {
		suffix += 1;
	}
	const aRange = { start: prefix, end: a.length - suffix };
	const bRange = { start: prefix, end: b.length - suffix };
	const aFraction = a.length > 0 ? (aRange.end - aRange.start) / a.length : 0;
	const bFraction = b.length > 0 ? (bRange.end - bRange.start) / b.length : 0;
	if (aFraction > 0.7 && bFraction > 0.7) return null;
	return { a: aRange, b: bRange };
}

/**
 * Wrap the [start, end) raw-character range of a highlighted line in
 * `<span class="diff-emph">`. Offsets count source characters, so entities
 * (one escaped character) count as one; the wrapper never crosses token
 * tags — it closes and reopens around them instead, keeping nesting valid.
 */
function emphasizeRange(html: string, { start, end }: CharRange): string {
	if (start >= end) return html;
	const openTag = `<span class="diff-emph">`;
	let out = "";
	let raw = 0;
	let open = false;
	const close = () => {
		if (open) {
			out += "</span>";
			open = false;
		}
	};
	const tokens = html.match(/<\/?span[^>]*>|&[a-zA-Z][a-zA-Z0-9]*;|&#x?[0-9a-fA-F]+;|[^&<]+|[&<]/g);
	for (const token of tokens ?? []) {
		if (token.startsWith("<") && token.length > 1) {
			close();
			out += token;
			continue;
		}
		if (token.startsWith("&") && token.length > 1 && token.endsWith(";")) {
			const inside = raw >= start && raw < end;
			if (inside && !open) {
				out += openTag;
				open = true;
			} else if (!inside) {
				close();
			}
			out += token;
			raw += 1;
			continue;
		}
		const from = Math.min(Math.max(start - raw, 0), token.length);
		const to = Math.min(Math.max(end - raw, 0), token.length);
		const before = token.slice(0, from);
		const within = token.slice(from, to);
		const after = token.slice(to);
		if (before) {
			close();
			out += before;
		}
		if (within) {
			if (!open) {
				out += openTag;
				open = true;
			}
			out += within;
		}
		if (after) {
			close();
			out += after;
		}
		raw += token.length;
	}
	close();
	return out;
}

/**
 * Render diff lines as HTML for a `<pre><code>` block. The old and new
 * contents are highlighted as whole documents (so multi-line constructs keep
 * correct colors), then reassembled per line: changed lines are wrapped in
 * background-tint spans with a colored `+ `/`- ` sign (copied text reads as a
 * diff), and replaced line pairs get a `diff-emph` chip on the changed
 * segment. Context lines stay plain highlighted code.
 */
export function renderDiffHtml(lines: DiffLine[], highlight?: (text: string) => string): string {
	const oldRaw: string[] = [];
	const newRaw: string[] = [];
	for (const line of lines) {
		if (line.type !== "add") oldRaw.push(line.text);
		if (line.type !== "del") newRaw.push(line.text);
	}
	const hl = highlight ?? escapeHtml;
	let oldHtml = splitHighlightedLines(hl(oldRaw.join("\n")));
	let newHtml = splitHighlightedLines(hl(newRaw.join("\n")));
	if (oldHtml.length !== oldRaw.length || newHtml.length !== newRaw.length) {
		// A highlighter that altered line structure would desync the diff; fall
		// back to plain escaped lines rather than mislabel them
		oldHtml = oldRaw.map(escapeHtml);
		newHtml = newRaw.map(escapeHtml);
	}

	// Pair the k-th deleted line with the k-th added line of each changed block
	// (deletions always precede additions, see diffLines) for intra-line emphasis
	const emphOld = new Map<number, CharRange>();
	const emphNew = new Map<number, CharRange>();
	{
		let i = 0;
		let oi = 0;
		let ni = 0;
		while (i < lines.length) {
			if (lines[i].type === "context") {
				i += 1;
				oi += 1;
				ni += 1;
				continue;
			}
			if (lines[i].type === "add") {
				i += 1;
				ni += 1;
				continue;
			}
			const delI = i;
			const delOi = oi;
			while (i < lines.length && lines[i].type === "del") {
				i += 1;
				oi += 1;
			}
			const addI = i;
			const addNi = ni;
			while (i < lines.length && lines[i].type === "add") {
				i += 1;
				ni += 1;
			}
			const pairs = Math.min(addI - delI, i - addI);
			for (let k = 0; k < pairs; k += 1) {
				const segments = changedSegments(lines[delI + k].text, lines[addI + k].text);
				if (segments) {
					emphOld.set(delOi + k, segments.a);
					emphNew.set(addNi + k, segments.b);
				}
			}
		}
	}

	const out: string[] = [];
	let oi = 0;
	let ni = 0;
	for (const line of lines) {
		if (line.type === "context") {
			out.push(`  ${newHtml[ni]}`);
			oi += 1;
			ni += 1;
		} else if (line.type === "del") {
			const range = emphOld.get(oi);
			const html = range ? emphasizeRange(oldHtml[oi], range) : oldHtml[oi];
			out.push(`<span class="diff-line diff-del"><span class="diff-sign">- </span>${html}</span>`);
			oi += 1;
		} else {
			const range = emphNew.get(ni);
			const html = range ? emphasizeRange(newHtml[ni], range) : newHtml[ni];
			out.push(`<span class="diff-line diff-add"><span class="diff-sign">+ </span>${html}</span>`);
			ni += 1;
		}
	}
	return out.join("\n");
}
