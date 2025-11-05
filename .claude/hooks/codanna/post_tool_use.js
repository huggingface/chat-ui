#!/usr/bin/env node

import fs from "fs";
import path from "path";

/**
 * PostToolUse hook to log tool usage with token stats
 * Reads JSON from stdin and appends to logs/post_tool_use.jsonl
 *
 * Captures:
 * - Tool name and parameters
 * - Token usage (if available)
 * - Timing information
 * - Tool response
 */

function main() {
	try {
		// Read JSON input from stdin
		let input = "";

		process.stdin.on("data", (chunk) => {
			input += chunk;
		});

		process.stdin.on("end", () => {
			try {
				const data = JSON.parse(input);

				// Ensure log directory exists
				const logDir = path.join(process.cwd(), "logs");
				if (!fs.existsSync(logDir)) {
					fs.mkdirSync(logDir, { recursive: true });
				}

				// Extract useful metrics
				const logEntry = {
					timestamp: new Date().toISOString(),
					session_id: data.session_id,
					tool_name: data.tool_name,
					tool_input: data.tool_input,
					tool_response: data.tool_response,

					// Extract token stats if available
					// (We'll discover what fields exist in real data)
					tokens: data.tokens || data.usage || null,

					// Metadata
					hook_event_name: data.hook_event_name,
				};

				// Use JSONL format (JSON Lines) - one JSON object per line
				const logPath = path.join(logDir, "post_tool_use.jsonl");
				const jsonLine = JSON.stringify(logEntry) + "\n";
				fs.appendFileSync(logPath, jsonLine, "utf8");

				// Also log the RAW input to help us understand the schema
				const rawLogPath = path.join(logDir, "post_tool_use_raw.jsonl");
				const rawLine = JSON.stringify(data) + "\n";
				fs.appendFileSync(rawLogPath, rawLine, "utf8");

				process.exit(0);
			} catch (parseError) {
				// JSON parse error - exit cleanly
				console.error(`[post_tool_use] JSON parse error: ${parseError.message}`);
				process.exit(0);
			}
		});
	} catch (error) {
		// Any other error - exit cleanly to not break Claude
		console.error(`[post_tool_use] Error: ${error.message}`);
		process.exit(0);
	}
}

// Handle stdin errors
process.stdin.on("error", (error) => {
	console.error(`[post_tool_use] stdin error: ${error.message}`);
	process.exit(0);
});

main();
