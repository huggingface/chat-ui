#!/usr/bin/env node

/**
 * PreToolUse hook to validate Read operations
 * Loads configuration from hooks-config.json
 *
 * Exit codes (unified enforcement model):
 * 0 = allow operation (suggest level - logged for analysis)
 * 1 = allow with warning (warn level - shown to Claude)
 * 2 = block operation (block level - halts Claude)
 *
 * Logs:
 * - All validations: logs/tools/Read.jsonl (for evaluation and threshold tuning)
 * - Warnings/Blocks: stderr (shown to Claude for immediate action)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load configuration from JSON file
function loadConfig() {
	const defaults = {
		max_read_lines: 400,
		tolerance_lines: 200,
		thresholds: {
			block: {
				exit_code: 2,
				message:
					"Read operation blocked: exceeds maximum allowed lines.\nSuggestion: Split into smaller reads or use Grep.",
			},
			warn: {
				exit_code: 1,
				message:
					"Large read detected. Read size logged for analysis - consider optimization if pattern repeats.",
			},
		},
	};

	try {
		const configPath = path.join(__dirname, "hooks-config.json");
		const content = fs.readFileSync(configPath, "utf8");
		const config = JSON.parse(content);

		// Return read_validator config, merge with defaults
		return config.read_validator || defaults;
	} catch (error) {
		// Config not found or parse error - use defaults
		return defaults;
	}
}

// Determine enforcement level based on limit
function determineEnforcement(limit, config) {
	const maxWithTolerance = config.max_read_lines + config.tolerance_lines;

	// Block: exceeds max + tolerance (e.g., > 600)
	if (limit > maxWithTolerance) {
		return { level: "block", config: config.thresholds.block };
	}

	// Warn: within tolerance zone (401-600)
	if (limit > config.max_read_lines) {
		return { level: "warn", config: config.thresholds.warn };
	}

	// Allow: within max (0-400)
	return { level: "allow", config: null };
}

// Count lines in a file efficiently
function getLineCount(filePath) {
	try {
		const content = fs.readFileSync(filePath, "utf8");
		// Count newlines + 1 (for last line without newline)
		const lines = content.split("\n").length;
		return lines;
	} catch (error) {
		// If we can't read the file, allow the operation
		// (the Read tool will handle the actual file access error)
		return 0;
	}
}

// Log validation event to JSONL file
function logValidation(data, limit, offset, endLine, enforcement, isEntireFile = false) {
	try {
		const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
		const logDir = path.join(projectDir, "logs", "tools");
		const logFile = path.join(logDir, "Read.jsonl");

		// Ensure logs/tools directory exists
		fs.mkdirSync(logDir, { recursive: true });

		const logEntry = {
			timestamp: new Date().toISOString(),
			tool: "Read",
			limit: limit,
			offset: offset,
			end_line: endLine,
			is_entire_file: isEntireFile,
			enforcement_level: enforcement.level,
			exit_code: enforcement.config?.exit_code || 0,
			file_path: data.tool_input?.file_path || "unknown",
			session_id: data.session_id || "unknown",
			message: enforcement.config?.message || "Allowed",
		};

		// Append to JSONL file (one JSON object per line)
		fs.appendFileSync(logFile, JSON.stringify(logEntry) + "\n");
	} catch (error) {
		// Silently fail - logging shouldn't break the hook
		console.error(`[read_validator] Failed to log: ${error.message}`);
	}
}

function main() {
	const config = loadConfig();

	try {
		let input = "";

		process.stdin.on("data", (chunk) => {
			input += chunk;
		});

		process.stdin.on("end", () => {
			try {
				const data = JSON.parse(input);

				// Only validate Read tool
				if (data.tool_name !== "Read") {
					process.exit(0);
				}

				const toolInput = data.tool_input || {};
				let limit = toolInput.limit;
				const filePath = toolInput.file_path;
				const offset = toolInput.offset || 1;
				let isEntireFile = false;

				// If no limit specified, check actual file size
				if (!limit && filePath) {
					const lineCount = getLineCount(filePath);

					// If we couldn't read the file or it's empty, allow the operation
					// (the Read tool will handle the actual error)
					if (lineCount === 0) {
						process.exit(0);
					}

					// Set limit to actual file line count for validation
					limit = lineCount;
					isEntireFile = true;
				} else if (!limit) {
					// No limit and no file path - allow (shouldn't happen)
					process.exit(0);
				}

				const endLine = offset + limit - 1;

				// Determine enforcement level
				const enforcement = determineEnforcement(limit, config);

				// Log warn and block events for analysis
				if (enforcement.level === "warn" || enforcement.level === "block") {
					logValidation(data, limit, offset, endLine, enforcement, isEntireFile);
				}

				// Handle based on enforcement level
				switch (enforcement.level) {
					case "block": {
						const readType = isEntireFile ? "entire file" : "requested";
						console.error(
							`Read operation blocked: ${readType} ${limit} lines (${offset}-${endLine}).\n` +
								`Maximum: ${config.max_read_lines} + tolerance: ${config.tolerance_lines} = ${config.max_read_lines + config.tolerance_lines} lines.\n\n` +
								`${enforcement.config.message}`
						);
						process.exit(enforcement.config.exit_code);
					}

					case "warn": {
						const warnReadType = isEntireFile ? "entire file" : "read";
						console.error(
							`[WARN] Large ${warnReadType}: ${limit} lines (${offset}-${endLine}).\n` +
								`${enforcement.config.message}`
						);
						process.exit(enforcement.config.exit_code);
					}

					case "allow":
					default:
						// Within acceptable range - allow silently
						process.exit(0);
				}
			} catch (parseError) {
				console.error(`[read_validator] Parse error: ${parseError.message}`);
				process.exit(0);
			}
		});
	} catch (error) {
		console.error(`[read_validator] Error: ${error.message}`);
		process.exit(0);
	}
}

process.stdin.on("error", (error) => {
	console.error(`[read_validator] stdin error: ${error.message}`);
	process.exit(0);
});

main();
