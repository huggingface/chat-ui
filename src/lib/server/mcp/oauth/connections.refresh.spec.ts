import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { InvalidGrantError } from "@modelcontextprotocol/sdk/server/auth/errors.js";

// Stub only the network token refresh; the rest of exchange (assertBearerTokens, tokensWithExpiresAt,
// isRefreshGrantRejected) stays real so the connection-state transitions are exercised for real.
vi.mock("./exchange", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./exchange")>();
	return { ...actual, refreshTokens: vi.fn() };
});

import { collections, ready } from "$lib/server/database";
import { cleanupTestData, createTestLocals } from "$lib/server/api/__tests__/testHelpers";
import { createOAuthConnection, resolveOAuthAccessToken } from "./connections";
import { refreshTokens } from "./exchange";

const refreshTokensMock = vi.mocked(refreshTokens);

const serverUrl = "https://mcp.example.com/mcp";

const asMetadata = {
	issuer: "https://auth.example.com",
	authorization_endpoint: "https://auth.example.com/authorize",
	token_endpoint: "https://auth.example.com/token",
	response_types_supported: ["code"],
};

const clientInfo = {
	client_id: "client-id",
	client_secret: "client-secret",
	redirect_uris: ["https://chat.example.com/api/mcp/oauth/callback"],
};

async function createConnection(locals: App.Locals) {
	return createOAuthConnection(locals, {
		serverUrl,
		resource: serverUrl,
		resourceMetadataUrl: "https://mcp.example.com/.well-known/oauth-protected-resource/mcp",
		asMetadata,
		clientInfo,
	});
}

// Seed a connection with an access token due for refresh (expiry inside the 5-min margin).
async function seedExpiringTokens(
	connection: Awaited<ReturnType<typeof createConnection>>,
	refreshToken = "old-refresh"
) {
	await collections.mcpOAuthConnections.updateOne(
		{ _id: connection._id },
		{
			$set: {
				tokens: {
					access_token: "old-access",
					refresh_token: refreshToken,
					token_type: "Bearer",
					expires_at: Date.now() + 60_000,
				},
				status: "authorized",
			},
			$inc: { version: 1 },
		}
	);
}

beforeAll(async () => {
	await ready;
}, 30_000);

describe.sequential("MCP OAuth JIT token refresh", () => {
	afterEach(async () => {
		refreshTokensMock.mockReset();
		await cleanupTestData();
	});

	it("refreshes an expiring token and rotates the refresh token", async () => {
		const locals = createTestLocals();
		const connection = await createConnection(locals);
		await seedExpiringTokens(connection);
		refreshTokensMock.mockResolvedValue({
			access_token: "new-access",
			refresh_token: "new-refresh",
			token_type: "Bearer",
			expires_in: 3600,
		});

		const resolved = await resolveOAuthAccessToken(locals, connection._id.toString(), serverUrl);

		expect(resolved.accessToken).toBe("new-access");
		expect(refreshTokensMock).toHaveBeenCalledTimes(1);
		const persisted = await collections.mcpOAuthConnections.findOne({ _id: connection._id });
		expect(persisted?.tokens?.access_token).toBe("new-access");
		expect(persisted?.tokens?.refresh_token).toBe("new-refresh");
		expect(persisted?.status).toBe("authorized");
	});

	it("keeps the existing refresh token when the response omits one", async () => {
		const locals = createTestLocals();
		const connection = await createConnection(locals);
		await seedExpiringTokens(connection);
		refreshTokensMock.mockResolvedValue({
			access_token: "rotated-access",
			token_type: "Bearer",
			expires_in: 3600,
		});

		const resolved = await resolveOAuthAccessToken(locals, connection._id.toString(), serverUrl);

		expect(resolved.accessToken).toBe("rotated-access");
		const persisted = await collections.mcpOAuthConnections.findOne({ _id: connection._id });
		expect(persisted?.tokens?.refresh_token).toBe("old-refresh");
	});

	it("clears credentials and requires re-auth when the refresh grant is rejected", async () => {
		const locals = createTestLocals();
		const connection = await createConnection(locals);
		await seedExpiringTokens(connection);
		refreshTokensMock.mockRejectedValue(new InvalidGrantError("refresh token no longer valid"));

		await expect(
			resolveOAuthAccessToken(locals, connection._id.toString(), serverUrl)
		).rejects.toThrow(/renewed/);

		const persisted = await collections.mcpOAuthConnections.findOne({ _id: connection._id });
		expect(persisted?.tokens).toBeUndefined();
		expect(persisted?.status).toBe("authorization_required");
	});

	it("retains credentials when a refresh fails transiently", async () => {
		const locals = createTestLocals();
		const connection = await createConnection(locals);
		await seedExpiringTokens(connection);
		refreshTokensMock.mockRejectedValue(new Error("network unreachable"));

		await expect(
			resolveOAuthAccessToken(locals, connection._id.toString(), serverUrl)
		).rejects.toThrow(/network unreachable/);

		const persisted = await collections.mcpOAuthConnections.findOne({ _id: connection._id });
		expect(persisted?.tokens?.access_token).toBe("old-access");
		expect(persisted?.tokens?.refresh_token).toBe("old-refresh");
		expect(persisted?.status).toBe("authorized");
	});

	it("serializes concurrent refreshes into a single credential update", async () => {
		const locals = createTestLocals();
		const connection = await createConnection(locals);
		await seedExpiringTokens(connection);
		const seeded = await collections.mcpOAuthConnections.findOne({ _id: connection._id });
		const seededVersion = seeded?.version ?? 0;
		refreshTokensMock.mockResolvedValue({
			access_token: "shared-access",
			refresh_token: "shared-refresh",
			token_type: "Bearer",
			expires_in: 3600,
		});

		const [first, second] = await Promise.all([
			resolveOAuthAccessToken(locals, connection._id.toString(), serverUrl),
			resolveOAuthAccessToken(locals, connection._id.toString(), serverUrl),
		]);

		// Both callers get a working token, and the optimistic version+refresh_token guard collapses
		// the writes so credentials are replaced exactly once even if two refreshes race the lock.
		expect(first.accessToken).toBe("shared-access");
		expect(second.accessToken).toBe("shared-access");
		const persisted = await collections.mcpOAuthConnections.findOne({ _id: connection._id });
		expect(persisted?.tokens?.access_token).toBe("shared-access");
		expect(persisted?.tokens?.refresh_token).toBe("shared-refresh");
		expect(persisted?.status).toBe("authorized");
		expect(persisted?.version).toBe(seededVersion + 1);
	});
});
