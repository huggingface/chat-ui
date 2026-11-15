import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Family } from "./types";

export interface Reference {
	id: string;
	family: Family;
	conversationId: string;
	label: string | null;
	pass: boolean | null;
}

export function readReferences(dir: string): Reference[] {
	return readFileSync(join(dir, "references.jsonl"), "utf8")
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line) as Reference);
}

const order = (seed: string, id: string) =>
	createHash("sha256").update(`${seed}:${id}`).digest("hex");

/**
 * The cases an eval runs, the same for every arm given the same arguments: ones whose reference
 * label has a verdict (a real case of its family), one per conversation, in a seeded order.
 */
export function selectCases(
	references: Reference[],
	{ families, perFamily, seed }: { families: Family[]; perFamily: number; seed: string }
): Reference[] {
	return families.flatMap((family) => {
		const picked = new Map<string, Reference>();
		const pool = references
			.filter((r) => r.family === family && r.pass !== null)
			.sort((a, b) => order(seed, a.id).localeCompare(order(seed, b.id)));
		for (const r of pool) {
			if (picked.size >= perFamily) break;
			if (!picked.has(r.conversationId)) picked.set(r.conversationId, r);
		}
		return [...picked.values()];
	});
}
