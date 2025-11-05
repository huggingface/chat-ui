#!/usr/bin/env node

const { execSync } = require("child_process");
const ConfigResolver = require("./config-resolver");

/**
 * Execute codanna commands and return parsed JSON
 */
class CodannaExecutor {
	constructor(binaryPath = null, workingDir = null) {
		const envBinary =
			process.env.CODANNA_CLI || process.env.CODANNA_BINARY || process.env.CODANNA_BINARY_PATH;
		this.binaryPath = binaryPath || envBinary || "codanna";
		this.configResolver = new ConfigResolver(workingDir);
	}

	/**
	 * Execute a codanna command and return parsed JSON
	 * @param {string} command - The codanna subcommand (e.g., 'retrieve symbol')
	 * @param {string} args - Additional arguments
	 * @returns {Object} Parsed JSON response
	 * @throws {Error} If command fails or JSON is invalid
	 */
	execute(command, args = "") {
		// Get codanna command with --config flag if settings.toml exists
		const codannaCmd = this.configResolver.getCodannaCommand(this.binaryPath);
		const fullCommand = `${codannaCmd} ${command} ${args} --json`;

		// Use CLAUDE_WORKING_DIR environment variable set by Claude Code
		// Falls back to process.cwd() if not set (for standalone usage)
		const workingDir = process.env.CLAUDE_WORKING_DIR || process.cwd();

		try {
			const output = execSync(fullCommand, {
				encoding: "utf8",
				stdio: ["pipe", "pipe", "pipe"],
				cwd: workingDir,
			});

			return JSON.parse(output);
		} catch (error) {
			// Check if it's a codanna error (exit code 3 = not found)
			if (error.status === 3 && error.stdout) {
				return JSON.parse(error.stdout);
			}

			throw new Error(`Codanna execution failed: ${error.message}\nCommand: ${fullCommand}`);
		}
	}

	/**
	 * Find a symbol by name
	 * @param {string} symbolName - Name of the symbol to find
	 * @returns {Object} Symbol data
	 */
	findSymbol(symbolName) {
		return this.execute("retrieve symbol", symbolName);
	}

	/**
	 * Find callers of a function
	 * @param {string} functionName - Name of the function
	 * @returns {Object} Callers data
	 */
	findCallers(functionName) {
		return this.execute("retrieve callers", functionName);
	}

	/**
	 * Find calls made by a function
	 * @param {string} functionName - Name of the function
	 * @returns {Object} Calls data
	 */
	findCalls(functionName) {
		return this.execute("retrieve calls", functionName);
	}

	/**
	 * Search for symbols
	 * @param {string} query - Search query
	 * @param {number} limit - Maximum results
	 * @returns {Object} Search results
	 */
	search(query, limit = 5) {
		return this.execute("retrieve search", `"${query}" --limit ${limit}`);
	}

	/**
	 * Describe a symbol with full context
	 * @param {string} symbolName - Name of the symbol
	 * @returns {Object} Symbol description with relationships
	 */
	describe(symbolName) {
		return this.execute("retrieve describe", symbolName);
	}

	/**
	 * Semantic search with full context (MCP tool)
	 * @param {string} query - Natural language query
	 * @param {number} limit - Maximum results
	 * @param {string} lang - Optional language filter
	 * @returns {Object} Search results with context
	 */
	semanticSearch(query, limit = 5, lang = null) {
		let args = `query:"${query}" limit:${limit}`;
		if (lang) {
			args += ` lang:${lang}`;
		}
		return this.execute("mcp semantic_search_with_context", args);
	}
}

module.exports = CodannaExecutor;
