/** Ids dropped because a later row repeats an id already kept. */
export function droppedDuplicateIds<T extends { id: string }>(items: T[]): string[] {
	const seen = new Set<string>();
	const dropped: string[] = [];
	for (const item of items) {
		if (!seen.has(item.id)) {
			seen.add(item.id);
			continue;
		}
		if (!dropped.includes(item.id)) dropped.push(item.id);
	}
	return dropped;
}

/** Keep the first item for each id. Svelte `{#each}` keyed by id throws if a key repeats. */
export function dedupeById<T extends { id: string }>(items: T[]): T[] {
	const seen = new Set<string>();
	const unique: T[] = [];
	for (const item of items) {
		if (seen.has(item.id)) continue;
		seen.add(item.id);
		unique.push(item);
	}
	return unique;
}
