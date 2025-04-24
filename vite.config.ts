import { sveltekit } from "@sveltejs/kit/vite";
import Icons from "unplugin-icons/vite";
import { promises } from "fs";
import { defineConfig } from "vitest/config";
import { resolve } from "path";
import fs from "fs-extra";

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

// Copy node-llama-cpp/llama files to build output
function copyLlamaFiles() {
	return {
		name: "copy-llama-files",
		closeBundle: async () => {
			try {
				const sourcePath = resolve("node_modules/node-llama-cpp/llama");
				const destPath = resolve("build/server/llama");

				// Ensure destination directory exists
				await fs.ensureDir(destPath);

				// Copy files
				await fs.copy(sourcePath, destPath);
				console.log("✓ Successfully copied llama files to build output");
			} catch (error) {
				console.error("Error in llama files process:", error);
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
		copyLlamaFiles(),
	],
	optimizeDeps: {
		include: ["uuid", "@huggingface/transformers", "sharp", "@gradio/client", "clsx"],
	},
	server: {
		open: "/",
	},
	test: {
		setupFiles: ["./scripts/setupTest.ts"],
		deps: { inline: ["@sveltejs/kit"] },
		globals: true,
		testTimeout: 10000,
	},
});
