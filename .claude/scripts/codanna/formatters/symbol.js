#!/usr/bin/env node

/**
 * Format symbol data for rich display
 */
class SymbolFormatter {
	/**
	 * Format a symbol response into readable output
	 * @param {Object} response - Codanna symbol response
	 * @returns {string} Formatted output
	 */
	static format(response) {
		if (response.status === "not_found") {
			return `Symbol not found: ${response.metadata?.query || "unknown"}`;
		}

		if (response.status === "error") {
			return `Error: ${response.message || "Unknown error"}`;
		}

		// Handle both single item and items array
		const item = response.item || (response.items && response.items[0]);
		if (!item) {
			return "No symbol data available";
		}

		const { symbol, file_path, relationships } = item;
		const lines = [];

		// Header
		lines.push("");
		lines.push(`# ${symbol.name} [symbol_id:${symbol.id}]`);
		lines.push("");

		// Symbol metadata
		lines.push(`**Kind:** ${symbol.kind}`);
		lines.push(`**Language:** ${symbol.language_id}`);
		lines.push(`**Visibility:** ${symbol.visibility}`);
		lines.push("");

		// Location (file_path already includes range from codanna)
		lines.push(`**Location:** ${file_path || "N/A"}`);
		lines.push(`**Module:** ${symbol.module_path || "N/A"}`);
		lines.push("");

		// Signature
		if (symbol.signature) {
			lines.push("**Signature:**");
			lines.push("```");
			lines.push(symbol.signature);
			lines.push("```");
			lines.push("");
		}

		// Documentation
		if (symbol.doc_comment) {
			lines.push("**Documentation:**");
			lines.push(symbol.doc_comment);
			lines.push("");
		}

		// Relationships - handle null relationships gracefully
		if (relationships) {
			const hasRelationships = Object.values(relationships).some(
				(r) => r && Array.isArray(r) && r.length > 0
			);

			if (hasRelationships) {
				lines.push("## Relationships");
				lines.push("");

				if (Array.isArray(relationships.implements) && relationships.implements.length > 0) {
					lines.push("**Implements:**");
					relationships.implements.forEach((item) => {
						const impl = Array.isArray(item) ? item[0] : item;
						SymbolFormatter.formatRelationshipLines(impl).forEach((line) => lines.push(line));
					});
					lines.push("");
				}

				if (
					Array.isArray(relationships.implemented_by) &&
					relationships.implemented_by.length > 0
				) {
					lines.push("**Implemented by:**");
					relationships.implemented_by.forEach((item) => {
						const impl = Array.isArray(item) ? item[0] : item;
						SymbolFormatter.formatRelationshipLines(impl).forEach((line) => lines.push(line));
					});
					lines.push("");
				}

				if (Array.isArray(relationships.calls) && relationships.calls.length > 0) {
					lines.push("**Calls:**");
					relationships.calls.forEach((item) => {
						const callee = Array.isArray(item) ? item[0] : item;
						SymbolFormatter.formatRelationshipLines(callee).forEach((line) => lines.push(line));
					});
					lines.push("");
				}

				if (Array.isArray(relationships.called_by) && relationships.called_by.length > 0) {
					lines.push("**Called by:**");
					relationships.called_by.forEach((item) => {
						const [caller, calleeRef] = Array.isArray(item) ? item : [item, ""];
						SymbolFormatter.formatRelationshipLines(caller, calleeRef).forEach((line) =>
							lines.push(line)
						);
					});
					lines.push("");
				}

				if (Array.isArray(relationships.defines) && relationships.defines.length > 0) {
					lines.push("**Defines:**");
					relationships.defines.forEach((item) => {
						const defined = Array.isArray(item) ? item[0] : item;
						SymbolFormatter.formatRelationshipLines(defined).forEach((line) => lines.push(line));
					});
					lines.push("");
				}
			}
		}

		// Scope context
		if (symbol.scope_context) {
			lines.push("---");
			lines.push(`*Scope: ${symbol.scope_context}*`);
		}

		return lines.join("\n");
	}

	/**
	 * Format for compact display (one-line summary)
	 * @param {Object} response - Codanna symbol response
	 * @returns {string} Compact summary
	 */
	static formatCompact(response) {
		if (response.status !== "success") {
			return `${response.status}: ${response.metadata?.query || "unknown"}`;
		}

		const item = response.item || (response.items && response.items[0]);
		if (!item) return "No symbol data";

		const { symbol, file_path } = item;
		return `${symbol.kind} ${symbol.name} @ ${file_path || "unknown"}`;
	}

	/**
	 * Format as JSON (pretty-printed)
	 * @param {Object} response - Codanna symbol response
	 * @returns {string} Pretty JSON
	 */
	static formatJson(response) {
		return JSON.stringify(response, null, 2);
	}
}

/**
 * Helper to format a file path with an optional line range.
 */
SymbolFormatter.formatLocation = function formatLocation(filePath, range) {
	if (!filePath) {
		return "";
	}

	const basePath = SymbolFormatter.stripFileLineSuffix(filePath);
	const rangeStr = SymbolFormatter.formatRange(range);
	if (!rangeStr) {
		return basePath;
	}
	return `${basePath}:${rangeStr}`;
};

/**
 * Helper to format a relationship entry with location and module info.
 */
SymbolFormatter.formatRelationshipLines = function formatRelationshipLines(symbol, relationNote) {
	if (!symbol) {
		return ["  - (unknown symbol)"];
	}

	const note = relationNote ? ` → ${relationNote}` : "";
	const symbolId = symbol.id ? ` [symbol_id:${symbol.id}]` : "";
	const lines = [`  - ${symbol.name} (${symbol.kind})${note}${symbolId}`];

	// file_path already includes range from codanna
	if (symbol.file_path) {
		lines.push(`    **Location:** ${symbol.file_path}`);
	} else if (symbol.range && typeof symbol.range.start_line === "number") {
		const rangeStr = SymbolFormatter.formatRange(symbol.range);
		lines.push(`    **Range:** ${rangeStr}`);
	} else if (symbol.file_id !== undefined && symbol.file_id !== null) {
		lines.push(`    **File ID:** ${symbol.file_id}`);
	}

	if (symbol.module_path) {
		lines.push(`    **Module:** ${symbol.module_path}`);
	}

	return lines;
};

/**
 * Strip any trailing :line component from a file path string.
 */
SymbolFormatter.stripFileLineSuffix = function stripFileLineSuffix(filePath) {
	const colonIndex = filePath.lastIndexOf(":");
	if (colonIndex === -1) {
		return filePath;
	}

	const suffix = filePath.slice(colonIndex + 1);
	if (/^\d+$/.test(suffix)) {
		return filePath.slice(0, colonIndex);
	}

	return filePath;
};

/**
 * Format a Range object into start[-end] form.
 */
SymbolFormatter.formatRange = function formatRange(range) {
	if (!range || typeof range.start_line !== "number") {
		return "";
	}

	const startLine = range.start_line;
	const endLine = typeof range.end_line === "number" ? range.end_line : startLine;

	return endLine !== startLine ? `${startLine}-${endLine}` : `${startLine}`;
};

module.exports = SymbolFormatter;
