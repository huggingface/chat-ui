/**
 * Line diff between two artifact versions, used by the artifact panel to show
 * what an `update` operation changed.
 *
 * The whole file is emitted (changed lines marked, unchanged lines as
 * context), not just hunks: the code view stays a scrollable view of the
 * artifact, and the panel auto-scrolls to the first change. Rendering reuses
 * the hljs `addition`/`deletion` classes so the existing syntax theme colors
 * apply in both light and dark mode without a separate diff stylesheet.
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

function escapeHtml(text: string): string {
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Render diff lines as HTML for a `<pre><code>` block. Changed lines carry
 * git-style `+ `/`- ` prefixes (so copied text reads as a diff) and hljs
 * addition/deletion spans; context lines stay plain text.
 */
export function renderDiffHtml(lines: DiffLine[]): string {
	return lines
		.map((line) => {
			const text = escapeHtml(line.text);
			if (line.type === "add") return `<span class="hljs-addition">+ ${text}</span>`;
			if (line.type === "del") return `<span class="hljs-deletion">- ${text}</span>`;
			return `  ${text}`;
		})
		.join("\n");
}
