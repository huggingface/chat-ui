import { sveltekit } from "@sveltejs/kit/vite";
import Icons from "unplugin-icons/vite";
import { promises } from "fs";
import { defineConfig } from "vitest/config";
import { config } from "dotenv";

config({ path: "./.env.local" });

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
		allowedHosts: ["huggingface.ngrok.io"],
		// Disable Vite error overlay/modal
		hmr: {
			overlay: false,
		},
	},
	optimizeDeps: {
		include: ["uuid", "sharp", "clsx"],
		// Exclude server-only dependencies from client bundle
		exclude: [
			"sharp",
			"@resvg/resvg-js",
			"satori",
			"satori-html",
			"parquetjs",
			"yazl",
			"pino",
			"pino-pretty",
			"prom-client",
		],
	},
	build: {
		rollupOptions: {
			onwarn(warning, warn) {
				// Suppress warnings from external dependencies about unused imports
				// These are from elysia and exact-mirror, which we don't control
				if (
					warning.code === "UNUSED_EXTERNAL_IMPORT" &&
					(warning.source?.includes("elysia") ||
						warning.source?.includes("exact-mirror") ||
						warning.source?.includes("@sinclair/typebox"))
				) {
					return;
				}
				// Show all other warnings
				warn(warning);
			},
			output: {
				manualChunks: (id) => {
					// Server-only code should not be in client bundle
					if (id.includes("/src/lib/server/") || id.includes("\\src\\lib\\server\\")) {
						return;
					}

					// Vendor chunks for large libraries
					if (id.includes("node_modules")) {
						// Markdown and text processing
						if (
							id.includes("marked") ||
							id.includes("highlight.js") ||
							id.includes("katex") ||
							id.includes("dompurify") ||
							id.includes("isomorphic-dompurify")
						) {
							return "vendor-markdown";
						}

						// Hugging Face libraries
						if (id.includes("@huggingface/")) {
							return "vendor-huggingface";
						}

						// OpenAI SDK (should be server-only, but type imports might leak)
						if (id.includes("openai")) {
							return "vendor-openai";
						}

						// UI libraries
						if (
							id.includes("svelte") ||
							id.includes("@sveltejs") ||
							id.includes("unplugin-icons")
						) {
							return "vendor-svelte";
						}

						// Other large dependencies
						if (
							id.includes("date-fns") ||
							id.includes("nanoid") ||
							id.includes("superjson") ||
							id.includes("zod")
						) {
							return "vendor-utils";
						}

						// Default vendor chunk for other node_modules
						return "vendor";
					}
				},
			},
		},
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
