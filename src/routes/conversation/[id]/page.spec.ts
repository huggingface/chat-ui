import { beforeEach, expect, it, vi } from "vitest";
import type { PageLoad } from "./$types";

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("$app/environment", () => ({ browser: false }));
vi.mock("$lib/APIClient", () => ({
	useAPIClient: () => ({ conversations: () => ({ get }) }),
	handleResponse: (value: unknown) => value,
}));
import { load } from "./+page";

const id = "6ad03a4c353929f19edc560f";
const path = `/conversation/${id}?leafId=message`;
function event(user: object | null) {
	return {
		params: { id },
		depends: vi.fn(),
		fetch,
		url: new URL(path, "https://example.com"),
		parent: async () => ({ loginEnabled: true, user }),
	} as unknown as Parameters<PageLoad>[0];
}
beforeEach(() => {
	get.mockReset();
});
it("preserves the conversation and query through first sign-in", async () => {
	get.mockRejectedValue(new Error("Unauthorized"));
	await expect(load(event(null))).rejects.toMatchObject({
		status: 302,
		location: `/login?next=${encodeURIComponent(path)}`,
	});
});
it("does not start another login for an authenticated user denied access", async () => {
	get.mockRejectedValue(new Error("Not found"));
	await expect(load(event({ id: "another-user" }))).rejects.toMatchObject({
		status: 302,
		location: "/",
	});
});
it("allows an anonymously accessible conversation without forcing sign-in", async () => {
	const conversation = { shared: true, id };
	get.mockResolvedValue(conversation);
	await expect(load(event(null))).resolves.toEqual(conversation);
});
