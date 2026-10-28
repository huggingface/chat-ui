/** what the pane's keys reach on the record's lead player or image */
export interface MediaKeys {
	toggle?: () => void;
	seek?: (direction: -1 | 1) => void;
	step?: (frames: number) => void;
	comment?: () => void;
	mark?: () => void;
}

let current: MediaKeys | undefined;

/** the last stage to claim wins, the returned release only drops its own claim */
export function claimMediaKeys(keys: MediaKeys): () => void {
	current = keys;
	return () => {
		if (current === keys) current = undefined;
	};
}

export const mediaKeys = (): MediaKeys | undefined => current;
