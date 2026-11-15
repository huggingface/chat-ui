import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// Stub only the network revocation; the rest of exchange stays real.
vi.mock("./exchange", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./exchange")>();
	return { ...actual, tryRevokeToken: vi.fn() };
});

import { collections, ready } from "$lib/server/database";
import { cleanupTestData, createTestLocals } from "$lib/server/api/__tests__/testHelpers";
import { createOAuthConnection, deleteOAuthConnection } from "./connections";
import { tryRevokeToken } from "./exchange";

const revokeMock = vi.mocked(tryRevokeToken);
const serverUrl = "https://mcp.example.com/mcp";

const clientInfo = {
	client_id: "client-id",
	client_secret: "client-secret",
	redirect_uris: ["https://chat.example.com/api/mcp/oauth/callback"],
};

function asMetadata(withRevocation: boolean) {
	return {
		issuer: "https://auth.example.com",
		authorization_endpoint: "https://auth.example.com/authorize",
		token_endpoint: "https://auth.example.com/token",
		response_types_supported: ["code"],
		...(withRevocation ? { revocation_endpoint: "https://auth.example.com/revoke" } : {}),
	};
}

async function seedAuthorized(locals: App.Locals, withRevocation = true) {
	const connection = await createOAuthConnection(locals, {
		serverUrl,
		resource: serverUrl,
		resourceMetadataUrl: "https://mcp.example.com/.well-known/oauth-protected-resource/mcp",
		asMetadata: asMetadata(withRevocation),
		clientInfo,
	});
	await collections.mcpOAuthConnections.updateOne(
		{ _id: connection._id },
		{
			$set: {
				tokens: { access_token: "acc", refresh_token: "ref", token_type: "Bearer" },
				status: "authorized",
			},
		}
	);
	return connection;
}

beforeAll(async () => {
	await ready;
}, 30_000);

describe.sequential("MCP OAuth disconnect", () => {
	afterEach(async () => {
		revokeMock.mockReset();
		await cleanupTestData();
	});

	it("revokes both tokens, then deletes the record", async () => {
		const locals = createTestLocals();
		const connection = await seedAuthorized(locals);
		revokeMock.mockResolvedValue(true);

		const result = await deleteOAuthConnection(locals, connection._id.toString());

		expect(result).toEqual({ deleted: true, revoked: true });
		expect(revokeMock).toHaveBeenCalledTimes(2);
		expect(revokeMock.mock.calls.map((c) => c[0].tokenTypeHint)).toEqual([
			"refresh_token",
			"access_token",
		]);
		expect(await collections.mcpOAuthConnections.findOne({ _id: connection._id })).toBeNull();
	});

	it("keeps the record so the user can retry when revocation fails", async () => {
		const locals = createTestLocals();
		const connection = await seedAuthorized(locals);
		revokeMock.mockResolvedValue(false);

		const result = await deleteOAuthConnection(locals, connection._id.toString());

		expect(result).toEqual({ deleted: false, revoked: false });
		expect(await collections.mcpOAuthConnections.findOne({ _id: connection._id })).not.toBeNull();
	});

	it("force-deletes even when revocation fails", async () => {
		const locals = createTestLocals();
		const connection = await seedAuthorized(locals);
		revokeMock.mockResolvedValue(false);

		const result = await deleteOAuthConnection(locals, connection._id.toString(), { force: true });

		expect(result.deleted).toBe(true);
		expect(await collections.mcpOAuthConnections.findOne({ _id: connection._id })).toBeNull();
	});

	it("deletes without attempting revocation when the AS exposes no revocation endpoint", async () => {
		const locals = createTestLocals();
		const connection = await seedAuthorized(locals, false);

		const result = await deleteOAuthConnection(locals, connection._id.toString());

		expect(result).toEqual({ deleted: true, revoked: false });
		expect(revokeMock).not.toHaveBeenCalled();
		expect(await collections.mcpOAuthConnections.findOne({ _id: connection._id })).toBeNull();
	});
});
