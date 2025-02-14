import { sveltekit } from "@sveltejs/kit/vite";
import Icons from "unplugin-icons/vite";
import { promises } from "fs";
import { defineConfig } from "vitest/config";
import { svelteTesting } from "@testing-library/svelte/vite";

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
		svelteTesting(),
	],
	optimizeDeps: {
		include: ["uuid", "@huggingface/transformers", "sharp", "@gradio/client"],
	},
	server: {
		open: "/",
	},
	test: {
		workspace: [
			{
				test: {
					name: "node",
					include: ["src/**/*.spec.ts"],
					environment: "node",
					setupFiles: ["./scripts/setupTest.ts"],
					deps: { inline: ["@sveltejs/kit"] },
					globals: true,
				},
			},
			{
				test: {
					name: "jsdom",
					include: ["src/**/*.svelte.spec.ts"],
					setupFiles: ["./scripts/setupTest.ts"],
					deps: { inline: ["@sveltejs/kit"] },
					globals: true,
					testTimeout: 10000,
					environment: "jsdom",
				},
			},
		],
	},
});
