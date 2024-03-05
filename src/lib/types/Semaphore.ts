import type { Timestamps } from "./Timestamps";

export interface Semaphore extends Timestamps {
	key: string;
}
