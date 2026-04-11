import { defineConfig } from "vitest/config";

export default defineConfig({
	// Disable inherited CSS/PostCSS processing from the parent chat-ui project —
	// the Worker doesn't ship any CSS.
	css: {
		postcss: { plugins: [] },
	},
	test: {
		environment: "node",
		include: ["src/**/*.test.ts"],
	},
});
