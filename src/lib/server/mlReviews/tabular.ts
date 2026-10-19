import type { ReviewSchema } from "$lib/types/MlReview";
import { SUGGESTIONS_KEY } from "$lib/utils/review/schema";

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

/** rfc 4180, quoted cells may hold the delimiter, doubled quotes and newlines */
export function parseDelimited(
	text: string,
	format: TabularFormat,
	location: string
): TabularRows | { error: string } {
	const delimiter = format === "csv" ? "," : "\t";
	const lines: { cells: string[]; line: number }[] = [];
	let cells: string[] = [];
	let cell = "";
	let quoted = false;
	let line = 1;
	let startLine = 1;
	const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

	const endRow = () => {
		cells.push(cell);
		if (!(cells.length === 1 && cells[0] === "")) lines.push({ cells, line: startLine });
		cells = [];
		cell = "";
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
		} else if (char === "\n" || char === "\r") {
			if (char === "\r" && source[i + 1] === "\n") i += 1;
			endRow();
			line += 1;
			startLine = line;
		} else {
			cell += char;
		}
	}
	if (quoted)
		return { error: `${location} has a quoted cell opened on line ${startLine} that never closes` };
	if (cell !== "" || cells.length > 0) endRow();

	const [header, ...data] = lines;
	if (!header) return { error: `${location} is empty` };
	const columns = header.cells.map((name) => name.trim());
	const blank = columns.findIndex((name) => !name);
	if (blank !== -1) return { error: `${location} header column ${blank + 1} has no name` };
	const repeated = columns.find((name, i) => columns.indexOf(name) !== i);
	if (repeated) return { error: `${location} header names "${repeated}" twice` };

	const rows: Record<string, string>[] = [];
	for (const { cells: values, line: at } of data) {
		if (values.length !== columns.length) {
			return {
				error: `${location} line ${at} has ${values.length} cells, the header has ${columns.length}`,
			};
		}
		const row: Record<string, string> = {};
		values.forEach((value, i) => {
			if (value !== "") row[columns[i]] = value;
		});
		rows.push(row);
	}
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
