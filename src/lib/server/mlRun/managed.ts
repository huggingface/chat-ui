import type { Conversation } from "$lib/types/Conversation";

export const isManagedConversation = (conv: Pick<Conversation, "managedBy">) => !!conv.managedBy;
