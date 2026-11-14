/** where a conversation's trace lands in the dataset, the same file on every push */
export const traceDatasetFile = (conversationId: string) => `${conversationId.slice(-8)}.jsonl`;
