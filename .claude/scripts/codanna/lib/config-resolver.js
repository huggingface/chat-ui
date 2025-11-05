#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const os = require("os");

/**
 * Resolve Codanna configuration using existing infrastructure:
 * 1. Read .codanna/.project-id from working directory
 * 2. Load ~/.codanna/projects.json
 * 3. Find project path by ID
 * 4. Return path to settings.toml
 */
class ConfigResolver {
	constructor(workingDir = null) {
		this.workingDir =
			workingDir ||
			process.env.CLAUDE_PROJECT_DIR ||
			process.env.CODANNA_PROJECT_DIR ||
			process.cwd();
		this.globalCodannaDir = path.join(os.homedir(), ".codanna");
	}

	/**
	 * Read project ID from .codanna/.project-id
	 * @returns {string|null} Project ID or null if not found
	 */
	readProjectId() {
		const projectIdPath = path.join(this.workingDir, ".codanna", ".project-id");

		if (!fs.existsSync(projectIdPath)) {
			return null;
		}

		try {
			return fs.readFileSync(projectIdPath, "utf8").trim();
		} catch (error) {
			console.error(`Failed to read project ID: ${error.message}`);
			return null;
		}
	}

	/**
	 * Load projects registry from ~/.codanna/projects.json
	 * @returns {Object|null} Projects registry or null if not found
	 */
	loadProjectsRegistry() {
		const registryPath = path.join(this.globalCodannaDir, "projects.json");

		if (!fs.existsSync(registryPath)) {
			return null;
		}

		try {
			const content = fs.readFileSync(registryPath, "utf8");
			return JSON.parse(content);
		} catch (error) {
			console.error(`Failed to load projects registry: ${error.message}`);
			return null;
		}
	}

	/**
	 * Find project path by ID in registry
	 * @param {string} projectId - Project ID to lookup
	 * @returns {string|null} Project path or null if not found
	 */
	findProjectPath(projectId) {
		const registry = this.loadProjectsRegistry();

		if (!registry || !registry.projects) {
			return null;
		}

		const project = registry.projects[projectId];
		return project ? project.path : null;
	}

	/**
	 * Resolve settings.toml path using Codanna's infrastructure
	 * @returns {string|null} Path to settings.toml or null if not found
	 */
	resolveSettingsPath() {
		const projectId = this.readProjectId();

		if (!projectId) {
			// Fallback: try local .codanna/settings.toml
			const localSettings = path.join(this.workingDir, ".codanna", "settings.toml");
			return fs.existsSync(localSettings) ? localSettings : null;
		}

		const projectPath = this.findProjectPath(projectId);

		if (!projectPath) {
			return null;
		}

		const settingsPath = path.join(projectPath, ".codanna", "settings.toml");
		return fs.existsSync(settingsPath) ? settingsPath : null;
	}

	/**
	 * Get codanna command with appropriate --config flag
	 * @param {string} binaryPath - Path to codanna binary
	 * @returns {string} Command prefix (e.g., "codanna --config /path/to/settings.toml")
	 */
	getCodannaCommand(binaryPath = "codanna") {
		const settingsPath = this.resolveSettingsPath();

		if (settingsPath) {
			return `${binaryPath} --config "${settingsPath}"`;
		}

		// No settings found, use default
		return binaryPath;
	}

	/**
	 * Get project metadata from registry
	 * @returns {Object|null} Project metadata or null
	 */
	getProjectMetadata() {
		const projectId = this.readProjectId();
		if (!projectId) return null;

		const registry = this.loadProjectsRegistry();
		if (!registry || !registry.projects) return null;

		return registry.projects[projectId] || null;
	}
}

module.exports = ConfigResolver;
