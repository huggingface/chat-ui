import type { Timestamps } from "./Timestamps";

export interface Semaphore extends Timestamps {
	key: string;
	deleteAt: Date;
}

export enum Semaphores {
	ASSISTANTS_COUNT = "assistants.count",
	CONVERSATION_STATS = "conversation.stats",
	CONFIG_UPDATE = "config.update",
	MIGRATION = "migration",
	TEST_MIGRATION = "test.migration",
}
