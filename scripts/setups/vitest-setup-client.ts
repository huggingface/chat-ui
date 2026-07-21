/*
 * Setup for the `client` (real-browser) workspace.
 *
 * The stylesheet is load-bearing: without it Tailwind size utilities are inert, so anything
 * asserting layout or computed style silently measures an unconstrained element.
 *
 * `appMocks` is imported for its `vi.mock` side effects, which stand in for the `$app/*` modules.
 */
import "../../src/styles/main.css";
import "../../src/lib/components/__tests__/appMocks";
