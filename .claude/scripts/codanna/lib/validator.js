#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

/**
 * Validate JSON responses against schemas
 */
class SchemaValidator {
	constructor(schemasDir = path.join(__dirname, "../schemas")) {
		this.schemasDir = schemasDir;
		this.schemas = new Map();
	}

	/**
	 * Load a schema by name
	 * @param {string} schemaName - Name of schema file (without .json)
	 * @returns {Object} Parsed schema
	 */
	loadSchema(schemaName) {
		if (this.schemas.has(schemaName)) {
			return this.schemas.get(schemaName);
		}

		const schemaPath = path.join(this.schemasDir, `${schemaName}.json`);

		if (!fs.existsSync(schemaPath)) {
			throw new Error(`Schema not found: ${schemaPath}`);
		}

		const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
		this.schemas.set(schemaName, schema);
		return schema;
	}

	/**
	 * Basic validation (can be extended with ajv for full JSON Schema validation)
	 * @param {Object} data - Data to validate
	 * @param {string} schemaName - Schema to validate against
	 * @returns {Object} Validation result { valid: boolean, errors: Array }
	 */
	validate(data, schemaName) {
		const schema = this.loadSchema(schemaName);
		const errors = [];

		// Check required top-level properties
		if (schema.required) {
			for (const prop of schema.required) {
				if (!(prop in data)) {
					errors.push(`Missing required property: ${prop}`);
				}
			}
		}

		// Check status values
		if (data.status && schema.properties?.status?.enum) {
			if (!schema.properties.status.enum.includes(data.status)) {
				errors.push(`Invalid status: ${data.status}`);
			}
		}

		return {
			valid: errors.length === 0,
			errors,
		};
	}

	/**
	 * Validate and throw on error
	 * @param {Object} data - Data to validate
	 * @param {string} schemaName - Schema to validate against
	 * @throws {Error} If validation fails
	 */
	validateOrThrow(data, schemaName) {
		const result = this.validate(data, schemaName);
		if (!result.valid) {
			throw new Error(`Schema validation failed:\n${result.errors.join("\n")}`);
		}
	}
}

module.exports = SchemaValidator;
