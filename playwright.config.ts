import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: "./e2e",
	outputDir: "./e2e/test-results",
	fullyParallel: false,
	retries: 1,
	timeout: 30_000,
	expect: { timeout: 10_000 },
	use: {
		baseURL: "http://localhost:3000",
		screenshot: "on",
		trace: "retain-on-failure",
	},
	projects: [
		{
			name: "desktop-chromium",
			use: {
				...devices["Desktop Chrome"],
				viewport: { width: 1280, height: 800 },
			},
		},
		{
			name: "mobile-chrome",
			use: {
				...devices["Pixel 5"],
			},
		},
	],
});
