import type { Timestamps } from "./Timestamps";
import type { Assistant } from "./Assistant";

export interface AssistantStats extends Timestamps {
	_id: Assistant["_id"];
	dateWithHour: Date; // should be a Date with min,sec,ms set to zero (i.e. const a = new Date(); a.setUTCMinutes(0,0,0))
	count: number;
}
