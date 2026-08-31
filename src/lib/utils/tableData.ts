/*
 * Copyright 2023 Vercel, Inc.
 * Adapted from: https://github.com/vercel/streamdown/blob/main/packages/streamdown/lib/table/utils.ts
 */

export interface TableData {
	headers: string[];
	rows: string[][];
}

/**
 * Text content of a cell, with <br> turned back into a newline. Cells are rendered
 * markdown (links, emphasis, code spans), so the visible text is what gets exported
 * rather than the inline HTML.
 */
function extractCellText(node: Node): string {
	if (node.nodeType === Node.TEXT_NODE) {
		return node.textContent ?? "";
	}
	if (node.nodeType !== Node.ELEMENT_NODE) {
		return "";
	}
	const element = node as HTMLElement;
	if (element.tagName === "BR") {
		return "\n";
	}
	return Array.from(element.childNodes).map(extractCellText).join("");
}

export function extractTableData(tableElement: HTMLElement): TableData {
	const headers = Array.from(tableElement.querySelectorAll("thead th")).map((cell) =>
		extractCellText(cell).trim()
	);
	const rows = Array.from(tableElement.querySelectorAll("tbody tr")).map((row) =>
		Array.from(row.querySelectorAll("td")).map((cell) => extractCellText(cell).trim())
	);
	return { headers, rows };
}

function escapeCsvCell(value: string): string {
	return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function tableDataToCSV({ headers, rows }: TableData): string {
	const lines = headers.length ? [headers] : [];
	return [...lines, ...rows].map((row) => row.map(escapeCsvCell).join(",")).join("\n");
}

function escapeTsvCell(value: string): string {
	return value.replace(/\t/g, "\\t").replace(/\r/g, "\\r").replace(/\n/g, "\\n");
}

export function tableDataToTSV({ headers, rows }: TableData): string {
	const lines = headers.length ? [headers] : [];
	return [...lines, ...rows].map((row) => row.map(escapeTsvCell).join("\t")).join("\n");
}

// Backslashes must be escaped before pipes, otherwise the backslash pass would
// double-escape the ones just added for pipes.
function escapeMarkdownCell(value: string): string {
	return value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\n/g, "<br>");
}

export function tableDataToMarkdown({ headers, rows }: TableData): string {
	if (headers.length === 0) {
		return "";
	}
	const lines = [
		`| ${headers.map(escapeMarkdownCell).join(" | ")} |`,
		`| ${headers.map(() => "---").join(" | ")} |`,
	];
	for (const row of rows) {
		// Short rows are padded so every line keeps the header's column count.
		const cells = Array.from({ length: headers.length }, (_, i) =>
			i < row.length ? escapeMarkdownCell(row[i]) : ""
		);
		lines.push(`| ${cells.join(" | ")} |`);
	}
	return lines.join("\n");
}

/** Triggers a browser download of `content` as `filename`. */
export function saveFile(filename: string, content: string, mimeType: string) {
	// Excel on Windows guesses the system ANSI codepage for CSV without a BOM,
	// which corrupts non-ASCII text.
	const bom = mimeType.startsWith("text/csv") ? "\uFEFF" : "";
	const url = URL.createObjectURL(new Blob([bom + content], { type: mimeType }));
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);
}
