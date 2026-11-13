import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "@vitest/browser/context";
import { renderWithApp } from "$lib/components/__tests__/renderWithApp";
import ShareConversationModal from "./ShareConversationModal.svelte";

const ID = "66f9a1b2c3d4e5f6a7b8c9d0";

function mount(exportTrace: boolean, id = ID, user?: { username: string }, canPush = !!user) {
	renderWithApp(
		ShareConversationModal,
		{ open: true, exportTrace },
		{ page: { params: { id }, data: { publicConfig: {}, user, traceDatasetPush: canPush } } }
	);
	return document.querySelector<HTMLAnchorElement>("a[download]");
}

const repoInput = () =>
	document.querySelector<HTMLInputElement>('input[aria-label="Dataset repo"]');
const pushButton = () =>
	[...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Push"));

afterEach(() => vi.unstubAllGlobals());

describe("ShareConversationModal trace download", () => {
	it("links the conversation's export when asked to", () => {
		const link = mount(true);
		expect(link?.getAttribute("href")).toBe(`/api/v2/conversations/${ID}/export`);
		expect(link?.textContent?.trim()).toBe("Download");
	});

	it("offers nothing outside ML mode", () => {
		expect(mount(false, ID, { username: "alice" })).toBeNull();
		expect(repoInput()).toBeNull();
	});

	it("offers nothing on a share snapshot", () => {
		expect(mount(true, "abc1234", { username: "alice" })).toBeNull();
		expect(repoInput()).toBeNull();
	});
});

describe("ShareConversationModal push to dataset", () => {
	it("needs a sign-in that can write to the Hub", () => {
		mount(true, ID, { username: "alice" }, false);
		expect(repoInput()).toBeNull();
	});

	it("names the file the trace lands in", () => {
		mount(true, ID, { username: "alice" });
		expect(document.body.textContent).toContain(`traces/${ID}.json`);
	});

	it("suggests a dataset in the user's namespace and links the pushed file", async () => {
		const calls: { url: string; body: unknown }[] = [];
		vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
			calls.push({ url, body: JSON.parse(String(init?.body)) });
			return Response.json({
				url: "https://huggingface.co/datasets/alice/t/blob/main/x.json",
				created: true,
			});
		});
		mount(true, ID, { username: "alice" });
		expect(repoInput()?.value).toBe("alice/ml-intern-traces");

		await userEvent.click(pushButton() as HTMLElement);

		await expect.poll(() => document.body.textContent).toContain("Created the private dataset");
		expect(calls).toEqual([
			{
				url: `/api/v2/conversations/${ID}/export/dataset`,
				body: { repo: "alice/ml-intern-traces", allowPublic: false },
			},
		]);
		const hubLink = [...document.querySelectorAll("a")].find(
			(a) => a.textContent === "View on the Hub"
		);
		expect(hubLink?.getAttribute("href")).toBe(
			"https://huggingface.co/datasets/alice/t/blob/main/x.json"
		);
	});

	it("shows the server's reason when the push fails", async () => {
		vi.stubGlobal("fetch", async () =>
			Response.json(
				{ message: "Your Hugging Face sign-in cannot write to org/x." },
				{ status: 403 }
			)
		);
		mount(true, ID, { username: "alice" });

		await userEvent.click(pushButton() as HTMLElement);

		await expect.poll(() => document.body.textContent).toContain("cannot write to org/x");
	});

	it("pushes to a public dataset only after a second click", async () => {
		const bodies: unknown[] = [];
		vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
			const body = JSON.parse(String(init?.body));
			bodies.push(body);
			return body.allowPublic
				? Response.json({ url: "https://huggingface.co/x", created: false, private: false })
				: Response.json(
						{
							code: "public-dataset",
							message: "alice/open is public, anyone will be able to read this trace.",
						},
						{ status: 409 }
					);
		});
		mount(true, ID, { username: "alice" });

		await userEvent.click(pushButton() as HTMLElement);
		await expect.poll(() => document.body.textContent).toContain("alice/open is public");

		const anyway = [...document.querySelectorAll("button")].find(
			(b) => b.textContent === "Push anyway"
		);
		await userEvent.click(anyway as HTMLElement);

		await expect.poll(() => document.body.textContent).toContain("Pushed to the public dataset");
		expect(bodies).toEqual([
			{ repo: "alice/ml-intern-traces", allowPublic: false },
			{ repo: "alice/ml-intern-traces", allowPublic: true },
		]);
	});
});
