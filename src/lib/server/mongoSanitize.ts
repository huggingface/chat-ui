/**
 * MongoDB query sanitization utilities
 *
 * Prevents NoSQL injection attacks by ensuring user input cannot contain
 * MongoDB query operators like $ne, $gt, $regex, etc.
 */

/**
 * Sanitizes a value that will be used in a MongoDB query.
 * Ensures the value is a string and not an object that could contain query operators.
 *
 * @param value - The value to sanitize (could be user input from URL params, request body, etc.)
 * @returns The sanitized string value
 * @throws Error if value cannot be sanitized to a safe string
 */
export function sanitizeMongoString(value: unknown): string {
	// Reject objects (including arrays) which could contain query operators
	if (value === null || value === undefined) {
		throw new Error("Value cannot be null or undefined");
	}

	if (typeof value === "object") {
		throw new Error("Object values are not allowed - potential NoSQL injection");
	}

	// Convert to string and ensure it's a primitive type
	const stringValue = String(value);

	// Additional check: reject if the original wasn't already a string/number
	if (typeof value !== "string" && typeof value !== "number") {
		throw new Error("Value must be a string or number");
	}

	return stringValue;
}

/**
 * Sanitizes a session ID for use in MongoDB queries.
 * Session IDs should always be strings.
 */
export function sanitizeSessionId(sessionId: unknown): string {
	return sanitizeMongoString(sessionId);
}

/**
 * Sanitizes a parameter that could be a MongoDB ObjectId string.
 * Validates the format of the string to ensure it's a valid ObjectId.
 */
export function sanitizeObjectIdString(id: unknown): string {
	const sanitized = sanitizeMongoString(id);

	// ObjectId strings should be 24 hex characters
	if (!/^[a-f0-9]{24}$/i.test(sanitized)) {
		throw new Error("Invalid ObjectId format");
	}

	return sanitized;
}

/**
 * Sanitizes a share ID for use in MongoDB queries.
 * Share IDs have a specific format (7 characters).
 */
export function sanitizeShareId(id: unknown): string {
	const sanitized = sanitizeMongoString(id);

	// Share IDs are typically 7 characters, alphanumeric
	if (!/^[a-zA-Z0-9]{7}$/i.test(sanitized)) {
		throw new Error("Invalid share ID format");
	}

	return sanitized;
}

/**
 * Sanitizes a generic parameter ID that could be either a share ID (7 chars) or ObjectId (24 chars).
 */
export function sanitizeParamId(id: unknown): string {
	const sanitized = sanitizeMongoString(id);

	// Allow either 7-char share IDs or 24-char ObjectIds
	if (!/^[a-zA-Z0-9]{7}$|^[a-f0-9]{24}$/i.test(sanitized)) {
		throw new Error("Invalid ID format");
	}

	return sanitized;
}

/**
 * Sanitizes a user ID from external providers (e.g., HuggingFace user ID).
 * These are typically numeric or alphanumeric strings.
 */
export function sanitizeExternalUserId(userId: unknown): string {
	const sanitized = sanitizeMongoString(userId);

	// Validate it's alphanumeric/numeric (external provider IDs)
	if (!/^[a-zA-Z0-9_-]+$/.test(sanitized)) {
		throw new Error("Invalid external user ID format");
	}

	return sanitized;
}

/**
 * Sanitizes a config key for use in MongoDB queries.
 */
export function sanitizeConfigKey(key: unknown): string {
	const sanitized = sanitizeMongoString(key);

	// Config keys should be alphanumeric with underscores
	if (!/^[A-Z][A-Z0-9_]*$/.test(sanitized)) {
		throw new Error("Invalid config key format");
	}

	return sanitized;
}
