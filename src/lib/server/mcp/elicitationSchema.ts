import { MAX_OTHER_CHARS } from "$lib/types/McpElicitation";
import type {
	ElicitationField,
	ElicitationRequestPayload,
	ElicitationValue,
} from "$lib/types/McpElicitation";

/** Nothing here trusts its input: every value is authored by the MCP server. */

const MAX_FIELDS = 32;
const MAX_OPTIONS = 100;
const MAX_MESSAGE_CHARS = 2_000;
const MAX_TITLE_CHARS = 200;
const MAX_DESCRIPTION_CHARS = 1_000;
const MAX_ANSWER_CHARS = 10_000;

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
	typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;

const asText = (value: unknown, max: number): string | undefined => {
	if (typeof value !== "string") return undefined;
	// Stripped so a label cannot smuggle line breaks in and fake chrome around the form.
	const cleaned = value.replace(/[\p{Cc}\p{Cf}]/gu, " ").trim();
	if (!cleaned) return undefined;
	return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
};

/** `out[name] = x` on one of these hits an inherited setter instead of creating a key. */
const UNSAFE_FIELD_NAMES = new Set(["__proto__", "constructor", "prototype"]);

const asFiniteNumber = (value: unknown): number | undefined =>
	typeof value === "number" && Number.isFinite(value) ? value : undefined;

type Option = { value: string; label: string };

/** An untitled option shows its raw value, which still has to be safe to display. */
const labelOf = (value: string) =>
	asText(value, MAX_TITLE_CHARS) ?? value.slice(0, MAX_TITLE_CHARS);

/** The UI keys options by value, so duplicates would break rendering outright. */
const uniqueValues = (options: Option[]) =>
	new Set(options.map((o) => o.value)).size === options.length;

function optionsFromEnum(def: Record<string, unknown>): Option[] | undefined {
	if (!Array.isArray(def.enum)) return undefined;
	const values = def.enum.filter((v): v is string => typeof v === "string");
	if (values.length !== def.enum.length) return undefined;
	const names = Array.isArray(def.enumNames) ? def.enumNames : undefined;
	// A mismatched array would silently label an option with another option's name.
	const labelled = names?.length === values.length && names.every((n) => typeof n === "string");
	return values.map((value, i) => ({
		value,
		label: (labelled ? asText(names?.[i], MAX_TITLE_CHARS) : undefined) ?? labelOf(value),
	}));
}

function optionsFromConstList(list: unknown): Option[] | undefined {
	if (!Array.isArray(list)) return undefined;
	const options: Option[] = [];
	for (const entry of list) {
		const obj = asRecord(entry);
		if (!obj || typeof obj.const !== "string") return undefined;
		options.push({
			value: obj.const,
			label: asText(obj.title, MAX_TITLE_CHARS) ?? labelOf(obj.const),
		});
	}
	return options;
}

function normalizeField(name: string, raw: unknown, required: boolean): ElicitationField | null {
	const def = asRecord(raw);
	if (!def || UNSAFE_FIELD_NAMES.has(name)) return null;

	const common = {
		name,
		title: asText(def.title, MAX_TITLE_CHARS),
		description: asText(def.description, MAX_DESCRIPTION_CHARS),
		required,
	};

	if (def.type === "boolean") {
		return {
			kind: "boolean",
			...common,
			...(typeof def.default === "boolean" ? { default: def.default } : {}),
		};
	}

	if (def.type === "number" || def.type === "integer") {
		return {
			kind: "number",
			...common,
			integer: def.type === "integer",
			...(asFiniteNumber(def.minimum) !== undefined ? { minimum: def.minimum as number } : {}),
			...(asFiniteNumber(def.maximum) !== undefined ? { maximum: def.maximum as number } : {}),
			...(asFiniteNumber(def.default) !== undefined ? { default: def.default as number } : {}),
		};
	}

	if (def.type === "string") {
		const options = optionsFromConstList(def.oneOf) ?? optionsFromEnum(def);
		if (options) {
			if (options.length === 0 || options.length > MAX_OPTIONS) return null;
			if (!uniqueValues(options)) return null;
			const fallback = typeof def.default === "string" ? def.default : undefined;
			return {
				kind: "select",
				...common,
				multiple: false,
				options,
				...(fallback !== undefined && options.some((o) => o.value === fallback)
					? { default: fallback }
					: {}),
			};
		}
		const format =
			def.format === "email" || def.format === "uri" || def.format === "date"
				? def.format
				: def.format === "date-time"
					? ("date-time" as const)
					: undefined;
		return {
			kind: "string",
			...common,
			...(asFiniteNumber(def.minLength) !== undefined
				? { minLength: def.minLength as number }
				: {}),
			...(asFiniteNumber(def.maxLength) !== undefined
				? { maxLength: def.maxLength as number }
				: {}),
			...(format ? { format } : {}),
			...(typeof def.default === "string" ? { default: def.default } : {}),
		};
	}

	if (def.type === "array") {
		const items = asRecord(def.items);
		if (!items) return null;
		const options = optionsFromConstList(items.anyOf) ?? optionsFromEnum(items);
		if (!options || options.length === 0 || options.length > MAX_OPTIONS) return null;
		if (!uniqueValues(options)) return null;
		const known = new Set(options.map((o) => o.value));
		const fallback = Array.isArray(def.default)
			? def.default.filter((v): v is string => typeof v === "string" && known.has(v))
			: undefined;
		return {
			kind: "select",
			...common,
			multiple: true,
			options,
			...(asFiniteNumber(def.minItems) !== undefined ? { minItems: def.minItems as number } : {}),
			...(asFiniteNumber(def.maxItems) !== undefined ? { maxItems: def.maxItems as number } : {}),
			...(fallback?.length ? { default: fallback } : {}),
		};
	}

	return null;
}

export type NormalizeResult =
	| { ok: true; payload: Omit<ElicitationRequestPayload, "elicitationId"> }
	| { ok: false; reason: string };

export function normalizeElicitationRequest(params: unknown): NormalizeResult {
	const raw = asRecord(params);
	if (!raw) return { ok: false, reason: "Malformed elicitation params." };

	const message = asText(raw.message, MAX_MESSAGE_CHARS);
	if (!message) return { ok: false, reason: "Elicitation is missing a message." };

	if (raw.mode === "url") {
		if (typeof raw.url !== "string") return { ok: false, reason: "URL elicitation has no url." };
		let parsed: URL;
		try {
			parsed = new URL(raw.url);
		} catch {
			return { ok: false, reason: "URL elicitation has an unparseable url." };
		}
		// The user gets a one-click affordance for this, so no `javascript:`/`data:`/app schemes.
		if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
			return { ok: false, reason: `Unsupported URL scheme: ${parsed.protocol}` };
		}
		return { ok: true, payload: { server: "", mode: "url", message, url: parsed.toString() } };
	}

	if (raw.mode !== undefined && raw.mode !== "form") {
		return { ok: false, reason: `Unsupported elicitation mode: ${String(raw.mode)}` };
	}

	const schema = asRecord(raw.requestedSchema);
	const properties = asRecord(schema?.properties);
	if (!schema || !properties) {
		return { ok: false, reason: "Form elicitation has no requestedSchema.properties." };
	}

	const entries = Object.entries(properties);
	if (entries.length === 0) return { ok: false, reason: "Form elicitation requested no fields." };
	if (entries.length > MAX_FIELDS) {
		return { ok: false, reason: `Form elicitation requested too many fields (${entries.length}).` };
	}

	const required = new Set(
		(Array.isArray(schema.required) ? schema.required : []).filter(
			(name): name is string => typeof name === "string"
		)
	);

	const fields: ElicitationField[] = [];
	for (const [name, def] of entries) {
		const field = normalizeField(name, def, required.has(name));
		if (!field) return { ok: false, reason: `Unsupported field schema for "${name}".` };
		fields.push(field);
	}

	return { ok: true, payload: { server: "", mode: "form", message, fields } };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
// RFC 3339, so the offset is required — the form converts before submitting.
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function checkFormat(value: string, format: string): boolean {
	if (format === "email") return EMAIL.test(value);
	// Round-tripped, because Date.parse rolls impossible dates over (2024-02-31 -> March).
	if (format === "date") return DATE.test(value) && new Date(value).toISOString().startsWith(value);
	if (format === "date-time") return DATE_TIME.test(value) && !Number.isNaN(Date.parse(value));
	if (format === "uri") {
		try {
			new URL(value);
			return true;
		} catch {
			return false;
		}
	}
	return true;
}

export type ValidateResult =
	{ ok: true; content: Record<string, ElicitationValue> } | { ok: false; error: string };

/** The copy that counts: the browser's checks are for usability, this answer reaches the server. */
export function validateElicitationContent(
	fields: ElicitationField[],
	raw: unknown
): ValidateResult {
	const submitted = asRecord(raw);
	if (!submitted) return { ok: false, error: "Answer must be an object." };

	const known = new Set(fields.map((f) => f.name));
	for (const name of Object.keys(submitted)) {
		if (!known.has(name)) return { ok: false, error: `Unknown field "${name}".` };
	}

	const content: Record<string, ElicitationValue> = {};
	let totalChars = 0;

	for (const field of fields) {
		const value = submitted[field.name];
		const missing = value === undefined || value === null || value === "";
		if (missing) {
			if (field.required) return { ok: false, error: `"${field.name}" is required.` };
			continue;
		}

		switch (field.kind) {
			case "string": {
				if (typeof value !== "string") {
					return { ok: false, error: `"${field.name}" must be a string.` };
				}
				if (field.minLength !== undefined && value.length < field.minLength) {
					return { ok: false, error: `"${field.name}" is too short.` };
				}
				if (field.maxLength !== undefined && value.length > field.maxLength) {
					return { ok: false, error: `"${field.name}" is too long.` };
				}
				if (field.format && !checkFormat(value, field.format)) {
					return { ok: false, error: `"${field.name}" is not a valid ${field.format}.` };
				}
				totalChars += value.length;
				content[field.name] = value;
				break;
			}
			case "number": {
				if (typeof value !== "number" || !Number.isFinite(value)) {
					return { ok: false, error: `"${field.name}" must be a number.` };
				}
				if (field.integer && !Number.isInteger(value)) {
					return { ok: false, error: `"${field.name}" must be a whole number.` };
				}
				if (field.minimum !== undefined && value < field.minimum) {
					return { ok: false, error: `"${field.name}" is below the minimum.` };
				}
				if (field.maximum !== undefined && value > field.maximum) {
					return { ok: false, error: `"${field.name}" is above the maximum.` };
				}
				content[field.name] = value;
				break;
			}
			case "boolean": {
				if (typeof value !== "boolean") {
					return { ok: false, error: `"${field.name}" must be a boolean.` };
				}
				content[field.name] = value;
				break;
			}
			case "select": {
				const allowed = new Set(field.options.map((o) => o.value));
				// The one value not on the list, bounded because nothing upstream constrains it.
				const isOther = (v: string) =>
					field.allowOther === true && v.trim().length > 0 && v.length <= MAX_OTHER_CHARS;
				const permitted = (v: string) => allowed.has(v) || isOther(v);
				if (field.multiple) {
					if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
						return { ok: false, error: `"${field.name}" must be a list of strings.` };
					}
					const picked = value as string[];
					if (new Set(picked).size !== picked.length) {
						return { ok: false, error: `"${field.name}" has duplicate selections.` };
					}
					for (const v of picked) {
						if (!permitted(v))
							return { ok: false, error: `"${field.name}" has an unknown option.` };
					}
					// The form offers one box, so a second off-list value did not come from it.
					if (picked.filter((v) => !allowed.has(v)).length > 1) {
						return { ok: false, error: `"${field.name}" has more than one typed answer.` };
					}
					if (field.minItems !== undefined && picked.length < field.minItems) {
						return { ok: false, error: `"${field.name}" needs more selections.` };
					}
					if (field.maxItems !== undefined && picked.length > field.maxItems) {
						return { ok: false, error: `"${field.name}" has too many selections.` };
					}
					if (field.required && picked.length === 0) {
						return { ok: false, error: `"${field.name}" is required.` };
					}
					totalChars += picked.join("").length;
					content[field.name] = picked;
				} else {
					if (typeof value !== "string" || !permitted(value)) {
						return { ok: false, error: `"${field.name}" has an unknown option.` };
					}
					totalChars += value.length;
					content[field.name] = value;
				}
				break;
			}
		}
	}

	if (totalChars > MAX_ANSWER_CHARS) return { ok: false, error: "Answer is too large." };

	return { ok: true, content };
}
