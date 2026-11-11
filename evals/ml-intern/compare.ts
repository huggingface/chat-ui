/**
 * compares two outcome eval arms task by task
 *
 *   node --experimental-strip-types evals/ml-intern/compare.ts --a <base>/result.json --b <head>/result.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import { compareArms, markdown, type Arm } from "./report.ts";

function arg(flag: string): string | undefined {
	const at = process.argv.indexOf(flag);
	return at === -1 ? undefined : process.argv[at + 1];
}

const load = (path: string | undefined): Arm => {
	if (!path) throw new Error("usage: compare.ts --a <result.json> --b <result.json>");
	return JSON.parse(readFileSync(path, "utf8")) as Arm;
};

const a = load(arg("--a"));
const b = load(arg("--b"));
const rows = compareArms(a, b);
const summary = markdown(a, b, rows);
const out = arg("--out");
if (out) writeFileSync(out, JSON.stringify({ a: a.sha, b: b.sha, rows }, null, 2));
const md = arg("--markdown");
if (md) writeFileSync(md, `${summary}\n`);
console.log(summary);
