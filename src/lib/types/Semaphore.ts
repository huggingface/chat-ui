import type { Timestamps } from "./Timestamps";

export interface Semaphore extends Timestamps {
	isDBLocked: boolean;
	key: "semaphore";
}
