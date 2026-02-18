/**
 * MongoDB Input Sanitization Utilities
 *
 * These functions prevent NoSQL injection attacks by ensuring
 * user-supplied values are safe strings before being used in MongoDB queries.
 */

import { ObjectId } from "mongodb";

/**
 * Sanitizes a string value to prevent NoSQL injection.
 * Ensures the value is a plain string and not an object that could
 * contain MongoDB operators like $gt, $ne, etc.
 */
export function sanitizeMongoString(value: unknown): string {
	if (typeof value !== "string") {
		throw new Error("Expected string value");
	}
	return value;
}

/**
 * Sanitizes a session ID for use in MongoDB queries.
 * Returns undefined if the value is not a valid string.
 */
export function sanitizeSessionId(value: unknown): string | undefined {
	if (typeof value !== "string" || value.length === 0) {
		return undefined;
	}
	// Session IDs should be alphanumeric hex strings
	if (!/^[a-f0-9]+$/i.test(value)) {
		return undefined;
	}
	return value;
}

/**
 * Validates and sanitizes an ObjectId string.
 * Throws if the value is not a valid ObjectId format.
 */
export function sanitizeObjectIdString(value: unknown): string {
	if (typeof value !== "string") {
		throw new Error("Expected string value for ObjectId");
	}
	if (!ObjectId.isValid(value)) {
		throw new Error("Invalid ObjectId format");
	}
	return value;
}

/**
 * Sanitizes a share ID for MongoDB queries.
 * Share IDs should be valid ObjectId strings.
 */
export function sanitizeShareId(value: unknown): string | undefined {
	if (typeof value !== "string" || value.length === 0) {
		return undefined;
	}
	if (!ObjectId.isValid(value)) {
		return undefined;
	}
	return value;
}

/**
 * Sanitizes URL parameters used as MongoDB query values.
 * Ensures the param is a string and validates ObjectId format.
 */
export function sanitizeParamId(value: unknown): string {
	if (typeof value !== "string") {
		throw new Error("Invalid parameter: expected string");
	}
	if (!ObjectId.isValid(value)) {
		throw new Error("Invalid parameter: not a valid ObjectId");
	}
	return value;
}
