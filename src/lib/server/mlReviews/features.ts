import type { ReviewField, ReviewFieldType } from "$lib/types/MlReview";
import { REVIEW_LIMITS, REVIEW_NAME_PATTERN, SUGGESTIONS_KEY } from "$lib/utils/review/schema";

/** a column with its feature in the datasets library json */
export interface DatasetColumn {
	name: string;
	feature: unknown;
}

export interface ColumnType {
	type: ReviewFieldType;
	/** ClassLabel names, a stored integer shows as its name */
	names?: string[];
	/** a bare bytes and path struct, the declared field type says which media */
	anyMedia?: boolean;
}

const MEDIA = new Set<ReviewFieldType>(["image", "audio", "video"]);
export const isMediaType = (type: ReviewFieldType) => MEDIA.has(type);

const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const NUMERIC = /^(u?int\d+|float\d+|double|decimal\d*\(.*\)|halffloat)$/;

const isChatTurn = (feature: unknown) =>
	isObject(feature) && feature._type === undefined && "role" in feature && "content" in feature;

function listItem(feature: unknown): unknown {
	if (Array.isArray(feature)) return feature[0];
	if (isObject(feature)) return feature.feature;
	return undefined;
}

/** undefined for a column a review cannot show */
export function columnType(feature: unknown): ColumnType | undefined {
	if (Array.isArray(feature)) {
		return isChatTurn(listItem(feature)) ? { type: "chat" } : { type: "json" };
	}
	if (!isObject(feature)) return undefined;
	switch (feature._type) {
		case "Value": {
			const dtype = String(feature.dtype ?? "");
			if (dtype === "string" || dtype === "large_string") return { type: "text" };
			if (dtype === "bool") return { type: "category" };
			if (NUMERIC.test(dtype)) return { type: "number" };
			if (dtype.startsWith("timestamp") || dtype.startsWith("date") || dtype.startsWith("time")) {
				return { type: "text" };
			}
			return undefined;
		}
		case "ClassLabel":
			return {
				type: "category",
				...(Array.isArray(feature.names) ? { names: feature.names.map(String) } : {}),
			};
		case "Image":
			return { type: "image" };
		case "Audio":
			return { type: "audio" };
		case "Video":
			return { type: "video" };
		case "Media":
			return { type: "image", anyMedia: true };
		case "Sequence":
		case "List":
		case "LargeList":
			return isChatTurn(listItem(feature)) ? { type: "chat" } : { type: "json" };
		case "Translation":
		case "TranslationVariableLanguages":
		case "Array2D":
		case "Array3D":
		case "Array4D":
		case "Array5D":
		case "Json":
			return { type: "json" };
		case undefined:
			return { type: "json" };
		default:
			return undefined;
	}
}

/** snake case, unique, never the reserved suggestions key */
export function fieldNameFor(column: string, taken: Set<string>): string {
	let base = column
		.normalize("NFKD")
		.replace(/([a-z0-9])([A-Z])/g, "$1_$2")
		.toLowerCase()
		.replace(/[^a-z0-9_]+/g, "_")
		.replace(/_+/g, "_")
		.replace(/^_+|_+$/g, "");
	if (!/^[a-z]/.test(base)) base = `f_${base}`.replace(/_+$/, "");
	if (base === SUGGESTIONS_KEY) base = `${base}_column`;
	base = base.slice(0, 40).replace(/_+$/, "") || "column";
	let name = base;
	for (let n = 2; (taken.has(name) || !REVIEW_NAME_PATTERN.test(name)) && n < 1000; n += 1) {
		const suffix = `_${n}`;
		name = `${base.slice(0, 40 - suffix.length)}${suffix}`;
	}
	taken.add(name);
	return name;
}

export interface DerivedFields {
	fields: ReviewField[];
	/** columns left out and why */
	skipped: string[];
}

export function deriveFields(columns: DatasetColumn[], idColumn?: string): DerivedFields {
	const taken = new Set<string>();
	const fields: ReviewField[] = [];
	const skipped: string[] = [];
	for (const column of columns) {
		if (column.name === idColumn) continue;
		const kind = columnType(column.feature);
		if (!kind) {
			skipped.push(`${column.name} (unsupported type)`);
			continue;
		}
		if (fields.length >= REVIEW_LIMITS.fields) {
			skipped.push(`${column.name} (past ${REVIEW_LIMITS.fields} fields)`);
			continue;
		}
		const name = fieldNameFor(column.name, taken);
		fields.push({
			name,
			type: kind.type,
			...(name !== column.name ? { column: column.name } : {}),
		} as ReviewField);
	}
	return { fields, skipped };
}

export const columnOf = (field: Pick<ReviewField, "name" | "column">) => field.column ?? field.name;

function plain(value: unknown, depth = 0): unknown {
	if (typeof value === "bigint") return Number(value);
	if (value instanceof Date) return value.toISOString();
	if (value instanceof Uint8Array) return `<${value.byteLength} bytes>`;
	if (depth > 20) return null;
	if (Array.isArray(value)) return value.map((item) => plain(item, depth + 1));
	if (isObject(value)) {
		return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plain(v, depth + 1)]));
	}
	return value;
}

/** undefined shows the field empty */
export function cellValue(type: ReviewFieldType, value: unknown, kind?: ColumnType): unknown {
	if (value === null || value === undefined) return undefined;
	const v = plain(value);
	switch (type) {
		case "category":
			if (typeof v === "number" && kind?.names) return kind.names[v];
			return typeof v === "string" ? v : typeof v === "object" ? v : String(v);
		case "text":
		case "markdown":
		case "code":
			if (typeof v === "number" && kind?.names) return kind.names[v];
			return typeof v === "number" || typeof v === "boolean" ? String(v) : v;
		case "number":
			// csv cells arrive as text
			return typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : v;
		default:
			return v;
	}
}
