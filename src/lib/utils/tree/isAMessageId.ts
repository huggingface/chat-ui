import type { Message } from "$lib/types/Message";

export function isAMessageId(id: string): id is Message["id"] {
	return /^(\d+-){4}\d+$/.test(id);
}
