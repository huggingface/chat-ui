// This file provides DOMPurify for both browser and server environments
// In browser: uses dompurify directly
// In server: creates a jsdom window and initializes dompurify with it

import { browser } from "$app/environment";
import dompurify from "dompurify";
import { JSDOM } from "jsdom";

let DOMPurifyInstance: ReturnType<typeof dompurify>;

if (browser) {
	// Browser: use dompurify directly
	DOMPurifyInstance = dompurify;
} else {
	// Server: create jsdom window and initialize dompurify
	const window = new JSDOM("<!DOCTYPE html>").window;
	DOMPurifyInstance = dompurify(window as unknown as Window);
}

export default DOMPurifyInstance;
