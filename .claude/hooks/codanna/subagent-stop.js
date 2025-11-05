#!/usr/bin/env node

import fs from "fs";
import path from "path";
import readline from "readline";

/**
 * Stop hook - Session statistics analyzer
 *
 * Parses the session transcript to extract:
 * - Total token usage (input, output, cache hits)
 * - Tool usage distribution
 * - Session duration
 * - Cost estimation
 *
 * Outputs to logs/stats/subagent-sessions.jsonl
 */

async function parseTranscript(transcriptPath) {
	const stats = {
		tokens: {
			input: 0,
			output: 0,
			cache_read: 0,
			cache_creation: 0,
			total: 0,
		},
		tools: {},
		messages: {
			user: 0,
			assistant: 0,
		},
		timestamps: {
			start: null,
			end: null,
		},
		session_id: null,
		model: null,
	};

	// Create readline interface to stream large files
	const fileStream = fs.createReadStream(transcriptPath);
	const rl = readline.createInterface({
		input: fileStream,
		crlfDelay: Infinity,
	});

	for await (const line of rl) {
		try {
			const entry = JSON.parse(line);

			// Capture session metadata
			if (!stats.session_id && entry.sessionId) {
				stats.session_id = entry.sessionId;
			}

			// Track timestamps
			if (entry.timestamp) {
				const timestamp = new Date(entry.timestamp);
				if (!stats.timestamps.start || timestamp < stats.timestamps.start) {
					stats.timestamps.start = timestamp;
				}
				if (!stats.timestamps.end || timestamp > stats.timestamps.end) {
					stats.timestamps.end = timestamp;
				}
			}

			// Track message types
			if (entry.type === "user") {
				stats.messages.user++;
			} else if (entry.type === "assistant") {
				stats.messages.assistant++;

				// Extract model - use most recent (last) model seen
				// This captures the primary model rather than subagent models
				if (entry.model) {
					stats.model = entry.model;
				}
				// Also try message.model for compatibility with main session format
				if (entry.message?.model) {
					stats.model = entry.message.model;
				}

				// Sum token usage
				const usage = entry.message?.usage;
				if (usage) {
					stats.tokens.input += usage.input_tokens || 0;
					stats.tokens.output += usage.output_tokens || 0;
					stats.tokens.cache_read += usage.cache_read_input_tokens || 0;
					stats.tokens.cache_creation += usage.cache_creation_input_tokens || 0;
				}

				// Track tool usage
				const content = entry.message?.content;
				if (Array.isArray(content)) {
					for (const item of content) {
						if (item.type === "tool_use") {
							const toolName = item.name;
							stats.tools[toolName] = (stats.tools[toolName] || 0) + 1;
						}
					}
				}
			}
		} catch (err) {
			// Skip malformed lines
			console.error(`[subagent-stop] Warning: Skipped malformed line: ${err.message}`);
		}
	}

	// Calculate totals
	stats.tokens.total =
		stats.tokens.input +
		stats.tokens.output +
		stats.tokens.cache_read +
		stats.tokens.cache_creation;

	// Calculate duration
	if (stats.timestamps.start && stats.timestamps.end) {
		stats.duration_ms = stats.timestamps.end - stats.timestamps.start;
		stats.duration_seconds = Math.floor(stats.duration_ms / 1000);
	}

	return stats;
}

async function main() {
	let input = "";

	// Read JSON from stdin
	for await (const chunk of process.stdin) {
		input += chunk;
	}

	try {
		const data = JSON.parse(input);
		const transcriptPath = data.transcript_path;

		// Debug: Log what we received
		console.error(`[subagent-stop] Received transcript path: ${transcriptPath}`);
		console.error(`[subagent-stop] Input data:`, JSON.stringify(data, null, 2));

		if (!transcriptPath || !fs.existsSync(transcriptPath)) {
			console.error(`[subagent-stop] Transcript not found: ${transcriptPath}`);
			process.exit(0);
		}

		// Parse transcript
		const stats = await parseTranscript(transcriptPath);

		// Add metadata
		stats.hook_event = "SubagentStop";
		stats.cwd = data.cwd;
		stats.git_branch = data.gitBranch;
		stats.analyzed_at = new Date().toISOString();

		// Ensure stats directory exists
		const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
		const statsDir = path.join(projectDir, "logs", "stats");
		if (!fs.existsSync(statsDir)) {
			fs.mkdirSync(statsDir, { recursive: true });
		}

		// Append to sessions log (JSONL format)
		const logPath = path.join(statsDir, "subagent-sessions.jsonl");
		const logEntry = JSON.stringify(stats) + "\n";
		fs.appendFileSync(logPath, logEntry, "utf8");

		// Also write a "latest session" file for quick access
		const latestPath = path.join(statsDir, "latest-subagent-session.json");
		fs.writeFileSync(latestPath, JSON.stringify(stats, null, 2), "utf8");

		// Print summary to stderr (won't interfere with hook protocol)
		console.error("\n📊 Subagent Session Statistics:");
		console.error(
			`   Tokens: ${stats.tokens.total.toLocaleString()} (${stats.tokens.input.toLocaleString()} in, ${stats.tokens.output.toLocaleString()} out)`
		);
		console.error(
			`   Cache: ${stats.tokens.cache_read.toLocaleString()} read, ${stats.tokens.cache_creation.toLocaleString()} created`
		);
		console.error(
			`   Tools: ${Object.keys(stats.tools).length} types, ${Object.values(stats.tools).reduce((a, b) => a + b, 0)} total uses`
		);
		console.error(`   Duration: ${stats.duration_seconds}s`);
		console.error(`   Saved to: ${logPath}\n`);

		process.exit(0);
	} catch (err) {
		console.error(`[subagent-stop] Error: ${err.message}`);
		process.exit(0);
	}
}

main();
