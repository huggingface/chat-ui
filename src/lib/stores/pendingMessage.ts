import { writable } from "svelte/store";

export const pendingMessage = writable<
	| {
			content?: string;
			files: File[];
			pdfFile?: File;
	  }
	| undefined
>();
