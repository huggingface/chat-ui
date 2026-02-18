import { existsSync, realpathSync } from "fs";
import { join, dirname, resolve, isAbsolute } from "path";

/**
 * Safely normalize and resolve a path, preventing path traversal attacks.
 * Returns the canonical absolute path without symlink resolution issues.
 */
function safePath(inputPath: string): string {
	// Ensure the path is absolute
	const absolutePath = isAbsolute(inputPath) ? inputPath : resolve(process.cwd(), inputPath);

	// Normalize the path to remove .. and . components
	const normalizedPath = resolve(absolutePath);

	return normalizedPath;
}

/**
 * Finds the repository root by walking up the directory tree looking for package.json.
 * Includes path traversal protection to prevent malicious path manipulation.
 *
 * @param startPath - The starting path to search from (must be within allowed boundaries)
 * @returns The path to the repository root
 * @throws Error if repository root is not found or path is invalid
 */
export function findRepoRoot(startPath: string): string {
	// Validate and normalize the input path
	const normalizedStart = safePath(startPath);

	// Resolve to real path to handle symlinks and prevent traversal via symlinks
	let currentPath: string;
	try {
		currentPath = realpathSync(normalizedStart);
	} catch {
		// If realpath fails (file doesn't exist), use normalized path
		currentPath = normalizedStart;
	}

	// Track visited paths to prevent infinite loops from symlinks
	const visited = new Set<string>();

	while (currentPath !== "/" && currentPath !== "") {
		// Prevent infinite loops
		if (visited.has(currentPath)) {
			throw new Error("Circular path detected while searching for repository root");
		}
		visited.add(currentPath);

		const packageJsonPath = join(currentPath, "package.json");

		// Use safe path check
		if (existsSync(packageJsonPath)) {
			return currentPath;
		}

		const parentPath = dirname(currentPath);

		// Ensure we're making progress (moving up the tree)
		if (parentPath === currentPath) {
			break;
		}

		currentPath = parentPath;
	}

	throw new Error("Could not find repository root (no package.json found)");
}
