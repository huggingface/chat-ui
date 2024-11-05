import {
	type BrowserContext,
	chromium,
	devices,
	type Page,
	type BrowserContextOptions,
} from "playwright";
import { PlaywrightBlocker } from "@cliqz/adblocker-playwright";

async function initPlaywrightService() {
	if (playwrightService) return playwrightService;

	const browser = await chromium.launch({ headless: true });

	process.on("SIGINT", () => browser.close());

	const device = devices["Desktop Chrome"];
	const options: BrowserContextOptions = {
		...device,
		// Increasing width improves spatial clustering accuracy
		screen: {
			width: 3840,
			height: 1080,
		},
		viewport: {
			width: 3840,
			height: 1080,
		},
		reducedMotion: "reduce",
		acceptDownloads: false,
		timezoneId: "America/New_York",
		locale: "en-US",
	};
	const ctx = await browser.newContext(options);
	const blocker = await PlaywrightBlocker.fromPrebuiltAdsAndTracking(fetch).then((blker) =>
		blker.blockFonts().blockMedias().blockFrames()
	);
	return Object.freeze({ ctx, blocker });
}
let playwrightService: Promise<{ ctx: BrowserContext; blocker: PlaywrightBlocker }>;

export async function loadPage(url: string): Promise<Page> {
	if (!playwrightService) playwrightService = initPlaywrightService();
	const { ctx, blocker } = await playwrightService;

	const page = await ctx.newPage();
	await blocker.enableBlockingInPage(page);

	await page.goto(url, { waitUntil: "load", timeout: 2500 }).catch(() => {
		console.warn(`Failed to load page within 2.5s: ${url}`);
	});

	return page;
}
