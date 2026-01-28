import { sveltekit } from "@sveltejs/kit/vite";
import Icons from "unplugin-icons/vite";
import { promises } from "fs";
import { defineConfig } from "vitest/config";
import { config } from "dotenv";

// Load .env.local first (overrides), then .env as fallback
// This ensures env vars are available before config is evaluated
config({ path: "./.env.local" });
config({ path: "./.env" });

// Vite automatically loads .env.{mode} and .env.{mode}.local based on --mode flag
// But we need to load them here first for vars used in vite.config.ts itself

// used to load fonts server side for thumbnail generation
function loadTTFAsArrayBuffer() {
	return {
		name: "load-ttf-as-array-buffer",
		async transform(_src, id) {
			if (id.endsWith(".ttf")) {
				return `export default new Uint8Array([
			${new Uint8Array(await promises.readFile(id))}
		  ]).buffer`;
			}
		},
	};
}
export default defineConfig({
	plugins: [
		sveltekit(),
		Icons({
			compiler: "svelte",
		}),
		loadTTFAsArrayBuffer(),
	],
	// Allow external access via ngrok tunnel host
	server: {
		port: process.env.PORT ? parseInt(process.env.PORT) : 5173,
		// Allow any ngrok-free.app subdomain (dynamic tunnels)
		// See Vite server.allowedHosts: string[] | true
		// Using leading dot matches subdomains per Vite's host check logic
		allowedHosts: (() => {
			const hosts = process.env.VITE_ALLOWED_HOSTS
				? process.env.VITE_ALLOWED_HOSTS.split(",").map((h) => h.trim())
				: undefined;
			console.log("[vite.config] allowedHosts:", hosts);
			return hosts;
		})(),
	},
	optimizeDeps: {
		include: ["uuid", "clsx"],
		exclude: ["sharp"],
	},
	test: {
		workspace: [
			{
				// Client-side tests (Svelte components)
				extends: "./vite.config.ts",
				test: {
					name: "client",
					environment: "browser",
					browser: {
						enabled: true,
						provider: "playwright",
						instances: [{ browser: "chromium", headless: true }],
					},
					include: ["src/**/*.svelte.{test,spec}.{js,ts}"],
					exclude: ["src/lib/server/**", "src/**/*.ssr.{test,spec}.{js,ts}"],
					setupFiles: ["./scripts/setups/vitest-setup-client.ts"],
				},
			},
			{
				// SSR tests (Server-side rendering)
				extends: "./vite.config.ts",
				test: {
					name: "ssr",
					environment: "node",
					include: ["src/**/*.ssr.{test,spec}.{js,ts}"],
				},
			},
			{
				// Server-side tests (Node.js utilities)
				extends: "./vite.config.ts",
				test: {
					name: "server",
					environment: "node",
					include: ["src/**/*.{test,spec}.{js,ts}"],
					exclude: ["src/**/*.svelte.{test,spec}.{js,ts}", "src/**/*.ssr.{test,spec}.{js,ts}"],
					setupFiles: ["./scripts/setups/vitest-setup-server.ts"],
				},
			},
		],
	},
});
