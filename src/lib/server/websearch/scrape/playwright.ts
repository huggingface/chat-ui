import {
	chromium,
	devices,
	type Page,
	type BrowserContextOptions,
	type Response,
	type Browser,
} from "playwright";
import { PlaywrightBlocker } from "@cliqz/adblocker-playwright";
import { config } from "$lib/server/config";
import { logger } from "$lib/server/logger";
import { onExit } from "$lib/server/exitHandler";

const blocker =
	config.PLAYWRIGHT_ADBLOCKER === "true"
		? await PlaywrightBlocker.fromPrebuiltAdsAndTracking(fetch)
				.then((blker) => {
					const mostBlocked = blker.blockFonts().blockMedias().blockFrames().blockImages();
					if (config.WEBSEARCH_JAVASCRIPT === "false") return mostBlocked.blockScripts();
					return mostBlocked;
				})
				.catch((err) => {
					logger.error(err, "Failed to initialize PlaywrightBlocker from prebuilt lists");
					return PlaywrightBlocker.empty();
				})
		: PlaywrightBlocker.empty();

let browserSingleton: Promise<Browser> | undefined;
async function getBrowser() {
	const browser = await chromium.launch({ headless: true });
	onExit(() => browser.close());
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
		if (config.PLAYWRIGHT_ADBLOCKER === "true") {
			await blocker.enableBlockingInPage(page);
		}

		await page.route("**", (route, request) => {
			const requestUrl = request.url();
			if (!requestUrl.startsWith("https://")) {
				logger.warn(`Blocked request to: ${requestUrl}`);
				return route.abort();
			}
			return route.continue();
		});

		const res = await page
			.goto(url, { waitUntil: "load", timeout: parseInt(config.WEBSEARCH_TIMEOUT) })
			.catch(() => {
				console.warn(
					`Failed to load page within ${parseInt(config.WEBSEARCH_TIMEOUT) / 1000}s: ${url}`
				);
			});

		return await callback(page, res ?? undefined);
	} finally {
		await ctx.close();
	}
}
