import {
	chromium,
	devices,
	type Page,
	type BrowserContextOptions,
	type Response,
	type Browser,
} from "playwright";
import { PlaywrightBlocker } from "@cliqz/adblocker-playwright";
import { env } from "$env/dynamic/private";
import { logger } from "$lib/server/logger";

const blocker = await PlaywrightBlocker.fromPrebuiltAdsAndTracking(fetch)
	.then((blker) => {
		const mostBlocked = blker.blockFonts().blockMedias().blockFrames().blockImages();
		if (env.WEBSEARCH_JAVASCRIPT === "false") return mostBlocked.blockScripts();
		return mostBlocked;
	})
	.catch((err) => {
		logger.error("Failed to initialize PlaywrightBlocker from prebuilt lists", err);
		return PlaywrightBlocker.empty();
	});

let browserSingleton: Promise<Browser> | undefined;
async function getBrowser() {
	const browser = await chromium.launch({ headless: true });
	process.on("SIGINT", () => browser.close());
	browser.on("disconnected", () => {
		logger.warn("Browser closed");
		browserSingleton = undefined;
	});
	return browser;
}

async function getPlaywrightCtx() {
	if (!browserSingleton) browserSingleton = getBrowser();
	const browser = await browserSingleton;

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
	return browser.newContext(options);
}

export async function withPage<T>(
	url: string,
	callback: (page: Page, response?: Response) => Promise<T>
): Promise<T> {
	const ctx = await getPlaywrightCtx();

	try {
		const page = await ctx.newPage();
		await blocker.enableBlockingInPage(page);

		const res = await page.goto(url, { waitUntil: "load", timeout: 3500 }).catch(() => {
			console.warn(`Failed to load page within 2s: ${url}`);
		});

		// await needed here so that we don't close the context before the callback is done
		return await callback(page, res ?? undefined);
	} finally {
		ctx.close();
	}
}
