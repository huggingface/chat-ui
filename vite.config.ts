import { sveltekit } from "@sveltejs/kit/vite";
import Icons from "unplugin-icons/vite";
import { promises } from "fs";
import { defineConfig } from "vitest/config";
import { resolve } from "path";
import fs from "fs-extra";
import { spawn } from "child_process";
import type { Plugin } from "vite";

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
const isViteNode = process.argv.some((arg) => arg.includes("vite-node")) || !!process.env.VITE_NODE;
const skipLlamaCppBuild = process.env.SKIP_LLAMA_CPP_BUILD === "true";
const shouldCopyLlama =
	process.env.npm_lifecycle_event === "build" && !isViteNode && !skipLlamaCppBuild; // Copy node-llama-cpp/llama files to build output

function copyLlamaFiles() {
	return {
		name: "copy-llama-files",
		apply: "build" as const,
		closeBundle: async () => {
			try {
				// Run npx command first and pipe IO
				console.log("Running node-llama-cpp source download...");

				await new Promise((resolve, reject) => {
					const npxProcess = spawn("npx", ["--no", "node-llama-cpp", "source", "download"], {
						stdio: "inherit", // Pipe all IO to parent process
						shell: true,
					});

					npxProcess.on("close", (code) => {
						if (code === 0) {
							console.log("✓ Successfully downloaded llama source files");
							resolve(code);
						} else {
							reject(new Error(`npx command failed with code ${code}`));
						}
					});

					npxProcess.on("error", (err) => {
						reject(err);
					});
				});

				const sourcePath = resolve("node_modules/node-llama-cpp/llama");
				const destPath = resolve("build/server/llama");

				// Ensure destination directory exists
				await fs.ensureDir(destPath);

				// Copy files - using a filter to prevent copying files to subdirectories of themselves
				await fs.copy(sourcePath, destPath, {
					filter: (src, dest) => {
						// Skip if source path is inside destination path or vice versa
						if (src.includes(destPath) || dest.includes(sourcePath)) {
							console.log(`Skipping problematic copy: ${src} -> ${dest}`);
							return false;
						}
						return true;
					},
					overwrite: true,
					dereference: true,
				});

				console.log("✓ Successfully copied llama files to build output");
			} catch (error) {
				console.error("Error in llama files process:", error);
			}
		},
	} satisfies Plugin;
}

export default defineConfig({
	plugins: [
		sveltekit(),
		Icons({
			compiler: "svelte",
		}),
		loadTTFAsArrayBuffer(),
		...(shouldCopyLlama ? [copyLlamaFiles()] : []),
	],
	optimizeDeps: {
		include: ["uuid", "@huggingface/transformers", "sharp", "@gradio/client", "clsx"],
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
