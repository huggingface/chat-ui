import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";
import Icons from "unplugin-icons/vite";

const { sveltekit: svelteKitPlugin, icons: iconsPlugin } = {
  sveltekit,
  icons: Icons({ compiler: "svelte" })
};

export default defineConfig({
	plugins: [ svelteKitPlugin(), iconsPlugin ],
});
