import { PUBLIC_API_BASE_URL } from "$env/static/public";

/**
 * API origin prefix for fetch calls.
 * - Web: "" (empty string → relative URLs, current behavior)
 * - Capacitor: "https://myserver.com" (absolute URLs to remote backend)
 *
 * Set PUBLIC_API_BASE_URL at build time for native/Capacitor builds:
 *   PUBLIC_API_BASE_URL=https://myserver.com ADAPTER=static vite build
 */
export const apiOrigin: string = PUBLIC_API_BASE_URL ?? "";
