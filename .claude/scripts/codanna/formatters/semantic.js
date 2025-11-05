#!/usr/bin/env node

/**
 * Format semantic search results for rich display
 */
class SemanticFormatter {
	/**
	 * Format semantic search response into readable output
	 * @param {Object} response - Codanna semantic search response
	 * @returns {string} Formatted output
	 */
	static format(response) {
		if (response.status === "not_found" || !response.data || response.data.length === 0) {
			return "No results found for your query.";
		}

		if (response.status === "error") {
			return `Error: ${response.message || "Unknown error"}`;
		}

		const lines = [];

		// Header with system message
		lines.push(`# Search Results`);
		lines.push("");
		if (response.system_message) {
			lines.push(`> ${response.system_message}`);
			lines.push("");
		}

		// Results
		response.data.forEach((result, index) => {
			const { symbol, score, context } = result;
			const { file_path, relationships } = context;

			lines.push(`## ${index + 1}. ${symbol.name} (${symbol.kind}) [symbol_id:${symbol.id}]`);
			lines.push("");
			lines.push(`**Relevance:** ${(score * 100).toFixed(1)}%`);
			lines.push(`**Location:** ${file_path} (${symbol.scope_context})`);

			lines.push(`**Module:** ${symbol.module_path}`);
			lines.push(`**Visibility:** ${symbol.visibility}`);
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

			// Key relationships - handle null gracefully
			if (relationships) {
				const hasRelationships = Object.values(relationships).some(
					(r) => r && Array.isArray(r) && r.length > 0
				);
				if (hasRelationships) {
					lines.push("**Relationships:**");

					if (Array.isArray(relationships.called_by) && relationships.called_by.length > 0) {
						const callerCount = relationships.called_by.length;
						lines.push(`- **Called by ${callerCount} function(s):**`);
						// Show first 3 callers with locations
						relationships.called_by.slice(0, 3).forEach((item) => {
							const [caller] = Array.isArray(item) ? item : [item];
							const callerLocation = `${caller.module_path}:${caller.range.start_line}`;
							const callerId = caller.id ? ` [symbol_id:${caller.id}]` : "";
							lines.push(`  - \`${caller.name}\` (${caller.kind}) at ${callerLocation}${callerId}`);
						});
						if (callerCount > 3) {
							lines.push(`  - _... and ${callerCount - 3} more_`);
						}
					}

					if (Array.isArray(relationships.calls) && relationships.calls.length > 0) {
						const callCount = relationships.calls.length;
						lines.push(`- **Calls ${callCount} function(s):**`);
						// Show first 3 calls
						relationships.calls.slice(0, 3).forEach((item) => {
							const callee = Array.isArray(item) ? item[0] : item;
							const calleeId = callee.id ? ` [symbol_id:${callee.id}]` : "";
							lines.push(`  - \`${callee.name}\` (${callee.kind})${calleeId}`);
						});
						if (callCount > 3) {
							lines.push(`  - _... and ${callCount - 3} more_`);
						}
					}

					if (Array.isArray(relationships.defines) && relationships.defines.length > 0) {
						const defineCount = relationships.defines.length;
						lines.push(`- **Defines ${defineCount} symbol(s):**`);
						relationships.defines.slice(0, 3).forEach((item) => {
							const defined = Array.isArray(item) ? item[0] : item;
							const definedId = defined.id ? ` [symbol_id:${defined.id}]` : "";
							lines.push(`  - \`${defined.name}\` (${defined.kind})${definedId}`);
						});
						if (defineCount > 3) {
							lines.push(`  - _... and ${defineCount - 3} more_`);
						}
					}

					if (Array.isArray(relationships.implements) && relationships.implements.length > 0) {
						lines.push(
							`- **Implements:** ${relationships.implements
								.map((item) => {
									const impl = Array.isArray(item) ? item[0] : item;
									return impl.name;
								})
								.join(", ")}`
						);
					}

					if (
						Array.isArray(relationships.implemented_by) &&
						relationships.implemented_by.length > 0
					) {
						const implCount = relationships.implemented_by.length;
						lines.push(`- **Implemented by ${implCount} type(s)**`);
					}

					lines.push("");
				}
			}

			lines.push("---");
			lines.push("");
		});

		return lines.join("\n");
	}

	/**
	 * Format for compact display (one line per result)
	 * @param {Object} response - Codanna semantic search response
	 * @returns {string} Compact summary
	 */
	static formatCompact(response) {
		if (response.status !== "success" || !response.data || response.data.length === 0) {
			return "No results found";
		}

		const lines = response.data.map((result, index) => {
			const { symbol, score, context } = result;
			const relevance = (score * 100).toFixed(0);
			return `${index + 1}. [${relevance}%] ${symbol.kind} ${symbol.name} @ ${context.file_path}`;
		});

		return lines.join("\n");
	}

	/**
	 * Format as JSON (pretty-printed)
	 * @param {Object} response - Codanna semantic search response
	 * @returns {string} Pretty JSON
	 */
	static formatJson(response) {
		return JSON.stringify(response, null, 2);
	}
}

module.exports = SemanticFormatter;
