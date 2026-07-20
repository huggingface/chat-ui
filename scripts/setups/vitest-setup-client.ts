/*
 * Setup for the `client` (real-browser) workspace.
 *
 * Load the application stylesheet. Component tests run in a real Chromium, so any assertion
 * about layout or computed style depends on the same CSS the app ships — most importantly
 * the Tailwind utilities that establish size constraints.
 */
import "../../src/styles/main.css";
