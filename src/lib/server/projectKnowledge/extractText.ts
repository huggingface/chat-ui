import { PDFParse } from "pdf-parse";

const TEXT_MIMES = new Set([
	"text/plain",
	"text/markdown",
	"text/csv",
	"text/html",
	"text/xml",
	"application/json",
	"application/xml",
]);

const TEXT_EXTENSIONS = new Set([
	".txt",
	".md",
	".csv",
	".json",
	".xml",
	".html",
	".htm",
	".yaml",
	".yml",
	".toml",
]);

/**
 * Extract text content from a file buffer.
 * Returns empty string for unsupported file types.
 */
export async function extractText(buffer: Buffer, mime: string, name: string): Promise<string> {
	// PDF
	if (mime === "application/pdf" || name.endsWith(".pdf")) {
		const parser = new PDFParse({ data: new Uint8Array(buffer) });
		try {
			const result = await parser.getText();
			return result.text;
		} finally {
			await parser.destroy().catch(() => {});
		}
	}

	// Known text MIME types
	if (TEXT_MIMES.has(mime)) {
		return buffer.toString("utf-8");
	}

	// Fallback: check file extension
	const ext = name.lastIndexOf(".") >= 0 ? name.slice(name.lastIndexOf(".")).toLowerCase() : "";
	if (TEXT_EXTENSIONS.has(ext)) {
		return buffer.toString("utf-8");
	}

	return "";
}
