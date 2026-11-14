import { collections } from "$lib/server/database";
import type { RunRef } from "./types";

export class RunNotFoundError extends Error {
	constructor() {
		super("This conversation no longer exists.");
	}
}

export const ownerFilter = (run: RunRef) => ({ _id: run.conversationId, userId: run.ownerId });

export async function owns(run: RunRef): Promise<boolean> {
	return (await collections.conversations.countDocuments(ownerFilter(run), { limit: 1 })) > 0;
}

export async function assertOwns(run: RunRef): Promise<void> {
	if (!(await owns(run))) throw new RunNotFoundError();
}
