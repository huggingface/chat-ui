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
