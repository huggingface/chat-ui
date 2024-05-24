import {
	type BrowserContext,
	chromium,
	devices,
	type Page,
	type BrowserContextOptions,
	type Response,
} from "playwright";
import { PlaywrightBlocker } from "@cliqz/adblocker-playwright";
import { env } from "$env/dynamic/private";

// Singleton initialized by initPlaywrightService
let playwrightService: Promise<{ ctx: BrowserContext; blocker: PlaywrightBlocker }>;

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
	const blocker = await PlaywrightBlocker.fromPrebuiltAdsAndTracking(fetch).then((blker) => {
		const mostBlocked = blker.blockFonts().blockMedias().blockFrames().blockImages();
		if (env.WEBSEARCH_JAVASCRIPT === "false") return mostBlocked.blockScripts();
		return mostBlocked;
	});
	return Object.freeze({ ctx, blocker });
}

export async function loadPage(url: string): Promise<{ res?: Response; page: Page }> {
	if (!playwrightService) playwrightService = initPlaywrightService();
	const { ctx, blocker } = await playwrightService;

	const page = await ctx.newPage();
	await blocker.enableBlockingInPage(page);

	const res = await page.goto(url, { waitUntil: "load", timeout: 3500 }).catch(() => {
		console.warn(`Failed to load page within 2s: ${url}`);
	});

	return { res: res ?? undefined, page };
}
