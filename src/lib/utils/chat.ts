import type { ApiMessage, Message } from '$lib/Types';

export function mappingToMessages(mapping: Record<string, ApiMessage>) {
	// loop through mapping object keys and reorder messages with parent/children id
	const sortedMessages: Message[] = [];

	// Find objects without a parent
	const parent = Object.values(mapping).find((item) => !item.parent);

	if (!parent) return [];

	// Recursively add objects to the sorted list
	function traverse(item: ApiMessage) {
		sortedMessages.push(item.message);

		if (item.children.length) {
			// Only take first child for now until we support editing
			const child = mapping[item.children[0]];
			traverse(child);
		}
	}

	// Traverse the tree for each parent
	traverse(parent);

	return sortedMessages;
}
