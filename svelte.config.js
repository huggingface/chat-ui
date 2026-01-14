import adapterNode from "@sveltejs/adapter-node";
import adapterStatic from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import dotenv from "dotenv";
import { execSync } from "child_process";

dotenv.config({ path: "./.env.local", override: true });
dotenv.config({ path: "./.env" });

// Use static adapter for Capacitor builds (SPA mode), node adapter for web
const isCapacitor = process.env.CAPACITOR === "true";
const adapter = isCapacitor
	? adapterStatic({
			fallback: "index.html", // SPA fallback for client-side routing
			strict: false, // Don't fail on dynamic routes
		})
	: adapterNode();

function getCurrentCommitSHA() {
	try {
		return execSync("git rev-parse HEAD").toString();
	} catch (error) {
		console.error("Error getting current commit SHA:", error);
		return "unknown";
	}
}

process.env.PUBLIC_VERSION ??= process.env.npm_package_version;
process.env.PUBLIC_COMMIT_SHA ??= getCurrentCommitSHA();

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Consult https://kit.svelte.dev/docs/integrations#preprocessors
	// for more information about preprocessors
	preprocess: vitePreprocess(),

	kit: {
		adapter,

		paths: {
			base: process.env.APP_BASE || "",
			relative: false,
		},
		csrf: {
			// handled in hooks.server.ts, because we can have multiple valid origins
			checkOrigin: false,
		},
		csp: {
			directives: {
				...(process.env.ALLOW_IFRAME === "true" ? {} : { "frame-ancestors": ["'none'"] }),
			},
		},
		alias: {
			$api: "./src/lib/server/api",
			"$api/*": "./src/lib/server/api/*",
		},
		// For Capacitor builds, disable prerendering entirely (pure SPA mode)
		...(isCapacitor && {
			prerender: {
				entries: [],
			},
		}),
	},
};

export default config;
