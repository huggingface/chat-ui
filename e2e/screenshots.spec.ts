import { test, expect } from "@playwright/test";

test.describe("UI Screenshots", () => {
	test("main screen with conversation sidebar", async ({ page }, testInfo) => {
		await page.goto("/");
		await page.waitForLoadState("networkidle");

		// Wait for the main layout to be visible
		const mainContainer = page.locator("div.fixed.grid");
		await expect(mainContainer).toBeVisible();

		// On desktop, wait for the nav sidebar to be rendered
		if (testInfo.project.name === "desktop-chromium") {
			const nav = page.locator("nav").first();
			await expect(nav).toBeVisible();
		}

		// Dismiss the welcome modal if it appears
		const welcomeModal = page.getByRole("dialog");
		if (await welcomeModal.isVisible({ timeout: 2000 }).catch(() => false)) {
			// Try to close it by clicking the close / dismiss button
			const closeBtn = welcomeModal.getByRole("button").first();
			if (await closeBtn.isVisible()) {
				await closeBtn.click();
				await welcomeModal.waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});
			}
		}

		await page.screenshot({
			path: `e2e/screenshots/${testInfo.project.name}-main-screen.png`,
			fullPage: false,
		});
	});

	test("dark mode main screen", async ({ page }, testInfo) => {
		// Set dark mode via media emulation
		await page.emulateMedia({ colorScheme: "dark" });
		await page.goto("/");
		await page.waitForLoadState("networkidle");

		const mainContainer = page.locator("div.fixed.grid");
		await expect(mainContainer).toBeVisible();

		// Dismiss the welcome modal if it appears
		const welcomeModal = page.getByRole("dialog");
		if (await welcomeModal.isVisible({ timeout: 2000 }).catch(() => false)) {
			const closeBtn = welcomeModal.getByRole("button").first();
			if (await closeBtn.isVisible()) {
				await closeBtn.click();
				await welcomeModal.waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});
			}
		}

		await page.screenshot({
			path: `e2e/screenshots/${testInfo.project.name}-main-screen-dark.png`,
			fullPage: false,
		});
	});

	test("settings page", async ({ page }, testInfo) => {
		await page.goto("/settings/application");
		await page.waitForLoadState("networkidle");

		// Dismiss the welcome modal if it appears
		const welcomeModal = page.getByRole("dialog");
		if (await welcomeModal.isVisible({ timeout: 2000 }).catch(() => false)) {
			const closeBtn = welcomeModal.getByRole("button").first();
			if (await closeBtn.isVisible()) {
				await closeBtn.click();
				await welcomeModal.waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});
			}
		}

		await page.screenshot({
			path: `e2e/screenshots/${testInfo.project.name}-settings.png`,
			fullPage: false,
		});
	});

	test("models page", async ({ page }, testInfo) => {
		await page.goto("/models");
		await page.waitForLoadState("networkidle");

		// Dismiss the welcome modal if it appears
		const welcomeModal = page.getByRole("dialog");
		if (await welcomeModal.isVisible({ timeout: 2000 }).catch(() => false)) {
			const closeBtn = welcomeModal.getByRole("button").first();
			if (await closeBtn.isVisible()) {
				await closeBtn.click();
				await welcomeModal.waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});
			}
		}

		await page.screenshot({
			path: `e2e/screenshots/${testInfo.project.name}-models.png`,
			fullPage: false,
		});
	});
});
