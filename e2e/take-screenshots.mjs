/**
 * Screenshot capture script using the `playwright` package directly.
 * Run: node e2e/take-screenshots.mjs [base-url]
 *
 * Takes screenshots of key pages in both desktop and mobile viewports,
 * in light and dark mode. Outputs to e2e/screenshots/.
 */

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const screenshotsDir = join(__dirname, "screenshots");
mkdirSync(screenshotsDir, { recursive: true });

const BASE_URL = process.argv[2] || process.env.BASE_URL || "http://localhost:5173";

const viewports = {
	desktop: { width: 1280, height: 800 },
	mobile: { width: 393, height: 851 }, // Pixel 5
};

const pages = [
	{ name: "main-screen", path: "/" },
	{ name: "settings", path: "/settings/application" },
	{ name: "models", path: "/models" },
];

async function dismissWelcomeModal(page) {
	try {
		const dialog = page.getByRole("dialog");
		if (await dialog.isVisible({ timeout: 2000 })) {
			const closeBtn = dialog.getByRole("button").first();
			if (await closeBtn.isVisible({ timeout: 1000 })) {
				await closeBtn.click();
				await dialog.waitFor({ state: "hidden", timeout: 3000 });
			}
		}
	} catch {
		// No modal or already dismissed
	}
}

async function takeScreenshots() {
	const browser = await chromium.launch({ headless: true });

	for (const [viewportName, viewport] of Object.entries(viewports)) {
		for (const colorScheme of ["light", "dark"]) {
			const context = await browser.newContext({
				viewport,
				colorScheme,
				deviceScaleFactor: 2,
			});

			const page = await context.newPage();

			for (const { name, path } of pages) {
				const url = `${BASE_URL}${path}`;
				console.log(`  ${viewportName}/${colorScheme}/${name} -> ${url}`);

				try {
					await page.goto(url, { waitUntil: "networkidle", timeout: 15000 });
				} catch {
					// networkidle can time out on dev server, fall back to load
					await page.goto(url, { waitUntil: "load", timeout: 10000 });
					await page.waitForTimeout(2000);
				}

				await dismissWelcomeModal(page);
				// Small delay to ensure rendering is complete
				await page.waitForTimeout(500);

				const filename = `${viewportName}-${colorScheme}-${name}.png`;
				await page.screenshot({
					path: join(screenshotsDir, filename),
					fullPage: false,
				});
				console.log(`    -> ${filename}`);
			}

			await context.close();
		}
	}

	await browser.close();
	console.log(`\nScreenshots saved to ${screenshotsDir}`);
}

console.log(`Taking screenshots of ${BASE_URL}...\n`);
await takeScreenshots();
