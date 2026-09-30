import AuthorizeStep from "./AuthorizeStep.svelte";
import { render } from "vitest-browser-svelte";
import { page } from "@vitest/browser/context";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MCPOAuthState } from "$lib/types/Tool";

const mocks = vi.hoisted(() => ({
	openAuthPopup: vi.fn(),
	fetchOAuthConnectionState: vi.fn(),
}));

vi.mock("$lib/utils/mcpOAuth", () => ({
	startAuthFlow: vi.fn(async () => ({ authUrl: "https://auth.test/authorize", flowId: "flow-1" })),
	runFullPageAuthFlow: vi.fn(),
	openAuthPopup: mocks.openAuthPopup,
	fetchOAuthConnectionState: mocks.fetchOAuthConnectionState,
}));

const connection: MCPOAuthState = {
	connectionId: "conn-1",
	issuer: "https://auth.test",
	status: "authorization_required",
};

function renderStep() {
	const onauthorized = vi.fn();
	render(AuthorizeStep, {
		discovery: { requiresAuth: true, connection },
		serverUrl: "https://mcp.test/mcp",
		serverId: "server-1",
		onauthorized,
		oncancel: vi.fn(),
	});
	return { onauthorized };
}

afterEach(() => vi.clearAllMocks());

describe("AuthorizeStep", () => {
	// A COOP login page makes the popup read as closed while the user is still signing in.
	it("keeps waiting after the popup reads as closed and completes once the server is authorized", async () => {
		mocks.openAuthPopup.mockRejectedValue(new Error("popup-closed"));
		mocks.fetchOAuthConnectionState
			.mockResolvedValueOnce(connection)
			.mockResolvedValue({ ...connection, status: "authorized" });
		const { onauthorized } = renderStep();

		await page.getByRole("button", { name: /Authorize with/ }).click();

		await expect.element(page.getByText(/Waiting for sign-in to finish/)).toBeInTheDocument();
		await expect.poll(() => onauthorized.mock.calls.length, { timeout: 5_000 }).toBe(1);
		expect(onauthorized.mock.calls[0][0]).toMatchObject({
			ok: true,
			connection: { status: "authorized" },
		});
		await expect.element(page.getByText("Authorized", { exact: true })).toBeInTheDocument();
	});

	it("lets the user retry while waiting, without the old wait completing", async () => {
		mocks.openAuthPopup.mockRejectedValueOnce(new Error("popup-closed"));
		mocks.fetchOAuthConnectionState.mockResolvedValue(connection);
		const { onauthorized } = renderStep();

		const authorize = page.getByRole("button", { name: /Authorize with/ });
		await authorize.click();
		await expect.element(page.getByText(/Waiting for sign-in to finish/)).toBeInTheDocument();
		await expect.element(authorize).toBeEnabled();

		mocks.openAuthPopup.mockResolvedValueOnce({
			ok: true,
			flowId: "flow-1",
			connection: { ...connection, status: "authorized" },
		});
		await authorize.click();

		await expect.poll(() => onauthorized.mock.calls.length).toBe(1);
		expect(mocks.openAuthPopup).toHaveBeenCalledTimes(2);
	});
});
