import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";
import Icons from "unplugin-icons/vite";
import inlangPlugin from "@inlang/sdk-js/adapter-sveltekit";

export default defineConfig({
	plugins: [
		inlangPlugin(), //  must be bedore sveltekit plugin
		sveltekit(),
		Icons({
			compiler: "svelte",
		}),
	],
});
