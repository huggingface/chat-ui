import { closeSync, existsSync, openSync, readFileSync, readSync } from "node:fs";
import { join } from "node:path";
import type { DecisionCase, Family } from "./types";

/** a case's head (everything but the conversation) and where its line sits in the family file */
export interface CaseRow {
	head: Omit<DecisionCase, "conversation">;
	offset: number;
	length: number;
}

/** reads only each line's head, the conversation is last and can be megabytes */
export function indexCases(dir: string, family: Family): CaseRow[] {
	const path = join(dir, `${family}.jsonl`);
	if (!existsSync(path)) return [];
	const buffer = readFileSync(path);
	const marker = Buffer.from(',"conversation":');
	const rows: CaseRow[] = [];
	let start = 0;
	while (start < buffer.length) {
		let end = buffer.indexOf(10, start);
		if (end === -1) end = buffer.length;
		const cut = buffer.indexOf(marker, start);
		if (cut !== -1 && cut < end) {
			const head = JSON.parse(`${buffer.subarray(start, cut).toString("utf8")}}`);
			rows.push({ head, offset: start, length: end - start });
		}
		start = end + 1;
	}
	return rows;
}

export function readCaseAt(
	dir: string,
	family: Family,
	row: Pick<CaseRow, "offset" | "length">
): DecisionCase {
	const fd = openSync(join(dir, `${family}.jsonl`), "r");
	try {
		const buffer = Buffer.alloc(row.length);
		readSync(fd, buffer, 0, row.length, row.offset);
		return JSON.parse(buffer.toString("utf8")) as DecisionCase;
	} finally {
		closeSync(fd);
	}
}
