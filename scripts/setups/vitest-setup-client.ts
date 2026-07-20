/*
 * Setup for the `client` (real-browser) workspace.
 *
 * Load the application stylesheet. Component tests run in a real Chromium, so any assertion
 * about layout or computed style depends on the same CSS the app ships — most importantly
 * the Tailwind utilities that establish size constraints.
 *
 * Without this, utilities like `max-h-56` are inert: an element intended to be a fixed-height
 * viewport instead grows to fit its content, so overflow-driven behaviour (fade masks,
 * clipping, scroll affordances) can never trigger and tests asserting it fail for reasons
 * that have nothing to do with the component.
 *
 * The scroll suites are unaffected either way — their harness builds fixtures with explicit
 * inline styles precisely so it does not depend on the stylesheet.
 */
import "../../src/styles/main.css";
