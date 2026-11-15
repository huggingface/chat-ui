import type { ReviewSchema } from "$lib/types/MlReview";
import { SUGGESTIONS_KEY } from "$lib/utils/review/schema";
import { REVIEW_MAX_RECORDS } from "$lib/server/textGeneration/builtinTools/requestReviewDefinition";

export type TabularFormat = "csv" | "tsv";

/** picked from the path alone, the model passes the file as it is */
export function tabularFormat(path: string): TabularFormat | undefined {
	if (/\.csv$/i.test(path)) return "csv";
	if (/\.tsv$/i.test(path)) return "tsv";
	return undefined;
}

export interface TabularRows {
	columns: string[];
	/** one object per data row, an empty cell is left out like a sparse json row */
	rows: Record<string, string>[];
}

/** declared fields cap at 30, so a wider header can only fail and is refused while it is read */
export const TABULAR_MAX_COLUMNS = 64;

/** rfc 4180, quoted cells may hold the delimiter, doubled quotes and newlines */
export function parseDelimited(
	text: string,
	format: TabularFormat,
	location: string,
	maxRows = REVIEW_MAX_RECORDS
): TabularRows | { error: string } {
	const delimiter = format === "csv" ? "," : "\t";
	const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
	let columns: string[] | undefined;
	const rows: Record<string, string>[] = [];
	let cells: string[] = [];
	let cell = "";
	let quoted = false;
	let line = 1;
	let startLine = 1;

	const tooWide = (): string | undefined => {
		if (!columns && cells.length > TABULAR_MAX_COLUMNS) {
			return `${location} header has more than ${TABULAR_MAX_COLUMNS} columns`;
		}
		if (columns && cells.length > columns.length) {
			return `${location} line ${startLine} has more cells than the header's ${columns.length}`;
		}
		return undefined;
	};

	const endRow = (): string | undefined => {
		cells.push(cell);
		const values = cells;
		cells = [];
		cell = "";
		if (values.length === 1 && values[0] === "") return undefined;
		if (!columns) {
			if (values.length > TABULAR_MAX_COLUMNS) {
				return `${location} header has more than ${TABULAR_MAX_COLUMNS} columns`;
			}
			const names = values.map((name) => name.trim());
			const seen = new Set<string>();
			for (const [i, name] of names.entries()) {
				if (!name) return `${location} header column ${i + 1} has no name`;
				if (seen.has(name)) return `${location} header names "${name}" twice`;
				seen.add(name);
			}
			columns = names;
			return undefined;
		}
		if (values.length !== columns.length) {
			return `${location} line ${startLine} has ${values.length} cells, the header has ${columns.length}`;
		}
		if (rows.length >= maxRows) {
			return `${location} has more than ${maxRows} records; a review holds at most ${maxRows}. Split it into batches on the same schema`;
		}
		const row: Record<string, string> = {};
		const header = columns;
		values.forEach((value, i) => {
			if (value !== "") row[header[i]] = value;
		});
		rows.push(row);
		return undefined;
	};

	for (let i = 0; i < source.length; i += 1) {
		const char = source[i];
		if (quoted) {
			if (char === '"') {
				if (source[i + 1] === '"') {
					cell += '"';
					i += 1;
				} else {
					quoted = false;
				}
			} else {
				if (char === "\n") line += 1;
				cell += char;
			}
			continue;
		}
		if (char === '"' && cell === "") {
			quoted = true;
		} else if (char === delimiter) {
			cells.push(cell);
			cell = "";
			const wide = tooWide();
			if (wide) return { error: wide };
		} else if (char === "\n" || char === "\r") {
			if (char === "\r" && source[i + 1] === "\n") i += 1;
			const problem = endRow();
			if (problem) return { error: problem };
			line += 1;
			startLine = line;
		} else {
			cell += char;
		}
	}
	if (quoted) {
		return { error: `${location} has a quoted cell opened on line ${startLine} that never closes` };
	}
	if (cell !== "" || cells.length > 0) {
		const problem = endRow();
		if (problem) return { error: problem };
	}
	if (!columns) return { error: `${location} is empty` };
	return { columns, rows };
}

const parseJson = (value: string): unknown => {
	try {
		return JSON.parse(value);
	} catch {
		return value;
	}
};

/** cells become the declared types, one that does not convert stays text for the validator to name */
export function recordsFromTabular(
	schema: Pick<ReviewSchema, "idField" | "fields">,
	{ columns, rows }: TabularRows,
	location: string
): { records: Record<string, unknown>[] } | { error: string } {
	const declared = schema.fields.map((field) => field.name);
	if (!columns.includes(schema.idField)) {
		return {
			error: `${location} has no "${schema.idField}" column for id_field; its header is ${columns.join(", ")}`,
		};
	}
	const known = new Set([schema.idField, SUGGESTIONS_KEY, ...declared]);
	const unknown = columns.filter((name) => !known.has(name));
	if (unknown.length > 0) {
		return {
			error: `${location} header column${unknown.length > 1 ? "s" : ""} ${unknown
				.map((name) => `"${name}"`)
				.join(
					", "
				)} ${unknown.length > 1 ? "match" : "matches"} no declared field (fields: ${declared.join(", ")}); declare ${
				unknown.length > 1 ? "them" : "it"
			} or drop the column`,
		};
	}
	const types = new Map(schema.fields.map((field) => [field.name, field.type]));
	return {
		records: rows.map((row) =>
			Object.fromEntries(
				Object.entries(row).map(([name, value]) => {
					if (name === SUGGESTIONS_KEY) return [name, parseJson(value)];
					if (name === schema.idField && !types.has(name)) return [name, value];
					switch (types.get(name)) {
						case "number": {
							const number = Number(value.trim());
							return [name, value.trim() && Number.isFinite(number) ? number : value];
						}
						case "json":
						case "chat":
							return [name, parseJson(value)];
						default:
							return [name, value];
					}
				})
			)
		),
	};
}
