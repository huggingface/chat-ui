import { it, expect, vi } from "vitest";
import { chromium } from "playwright";
import { createServer } from "node:http";
import { once } from "node:events";
vi.mock("./auth", () => ({
	identity: () => ({ user: "U1" }),
	viewerConfig: () => ({ origin: "https://viewer.example" }),
}));
import { GET as pageResponse } from "../../../../routes/slack/view/[id]/+server";
import { GET as scriptResponse } from "../../../../routes/slack/view/viewer.js/+server";
it("renders tool diagnostics read-only, preserves expanded details and clears data on access loss", async () => {
	const html = await (
		await pageResponse({ params: { id: "a".repeat(24) } } as Parameters<typeof pageResponse>[0])
	).text();
	const script = await (await scriptResponse({} as Parameters<typeof scriptResponse>[0])).text();
	let allowed = true;
	const data = {
		state: { status: "waiting", waitReason: "Training job" },
		generation: { lastHeartbeatAt: new Date().toISOString() },
		budget: { spent: 20000, total: 1000000 },
		slackUrl: "https://app.slack.com/client/T1/C1",
		messages: [
			{
				id: "m1",
				role: "assistant",
				text: "Training started. Inspect the job below.",
				events: [
					{
						type: "tool",
						subtype: "call",
						call: { name: "hf_jobs", parameters: { flavor: "t4-small" } },
					},
					{
						type: "tool",
						subtype: "error",
						message: "Payload Too Large <script>window.pwned=true</script>",
					},
				],
			},
		],
	};
	const server = createServer((req, res) => {
		if (req.url?.endsWith("/data")) {
			res.writeHead(allowed ? 200 : 403, { "Content-Type": "application/json" });
			res.end(JSON.stringify(allowed ? data : {}));
		} else if (req.url?.endsWith("viewer.js")) {
			res.writeHead(200, { "Content-Type": "application/javascript" });
			res.end(script);
		} else {
			res.writeHead(200, { "Content-Type": "text/html" });
			res.end(html);
		}
	});
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const address = server.address();
	if (!address || typeof address === "string") throw Error("No server");
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 1200, height: 950 } });
		await page.goto(`http://127.0.0.1:${address.port}/slack/view/${"a".repeat(24)}`);
		await page.getByText("Training started. Inspect the job below.").waitFor();
		await page.getByText("tool · error", { exact: true }).click();
		expect(await page.locator("details[open]").count()).toBe(1);
		await page.getByRole("button", { name: "Refresh", exact: true }).click();
		await page.screenshot({ path: "/tmp/ml-slack-viewer.png", fullPage: true });
		expect(await page.evaluate("window.pwned")).toBeUndefined();
		expect(await page.getByRole("button").allTextContents()).toEqual(["Refresh", "Sign out"]);
		allowed = false;
		await page.getByRole("button", { name: "Refresh", exact: true }).click();
		await page.getByText("You no longer have access to this Slack session.").waitFor();
		expect(await page.locator("article").count()).toBe(0);
	} finally {
		await browser.close();
		server.close();
	}
}, 30000);
