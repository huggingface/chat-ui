import type { Message } from "$lib/types/Message";

export function isMessageId(id: string): id is Message["id"] {
	return /^(\d+-){4}\d+$/.test(id);
}
