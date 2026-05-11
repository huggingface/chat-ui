/**
 * URL validation and sanitization utilities for MCP integration
 */

import { browser } from "$app/environment";
import { dev } from "$app/environment";

/**
 * Sanitize and validate a URL for MCP server connections
 * @param urlString - The URL string to validate
 * @returns Sanitized URL string or null if invalid
 */
export function validateMcpServerUrl(urlString: string): string | null {
	if (!urlString || typeof urlString !== "string") {
		return null;
	}

	try {
		const url = new URL(urlString.trim());

		// Allow http/https only
		if (!["http:", "https:"].includes(url.protocol)) {
			return null;
		}

		// Warn about non-HTTPS in production
		if (!dev && url.protocol === "http:" && browser) {
			console.warn(
				"Warning: Connecting to non-HTTPS MCP server in production. This may expose sensitive data."
			);
		}

		// Block certain localhost/private IPs in production
		if (!dev && isPrivateOrLocalhost(url.hostname)) {
			console.warn("Warning: Localhost/private IP addresses are not recommended in production.");
		}

		return url.toString();
	} catch (error) {
		// Invalid URL
		return null;
	}
}

/**
 * Check if hostname is localhost or a private IP
 */
function isPrivateOrLocalhost(hostname: string): boolean {
	// Localhost checks
	if (
		hostname === "localhost" ||
		hostname === "127.0.0.1" ||
		hostname === "::1" ||
		hostname.endsWith(".localhost")
	) {
		return true;
	}

	// Private IP ranges (IPv4)
	const ipv4Regex = /^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|127\.|0\.0\.0\.0|169\.254\.)/;
	if (ipv4Regex.test(hostname)) {
		return true;
	}

	return false;
}

/**
 * Check if a header key is likely to contain sensitive data
 */
export function isSensitiveHeader(key: string): boolean {
	const sensitiveKeys = [
		"authorization",
		"api-key",
		"api_key",
		"apikey",
		"token",
		"secret",
		"password",
		"bearer",
		"x-api-key",
		"x-auth-token",
	];

	const lowerKey = key.toLowerCase();
	return sensitiveKeys.some((sensitive) => lowerKey.includes(sensitive));
}

/**
 * Validate header key-value pair
 * Returns error message if invalid, null if valid
 */
export function validateHeader(key: string, value: string): string | null {
	if (!key || !key.trim()) {
		return "Header name is required";
	}

	if (!/^[a-zA-Z0-9_-]+$/.test(key)) {
		return "Header name can only contain letters, numbers, hyphens, and underscores";
	}

	if (!value) {
		return "Header value is required";
	}

	return null;
}
