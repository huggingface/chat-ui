import { describe, expect, it } from "vitest";
import {
	InvalidGrantError,
	InvalidRequestError,
	ServerError,
} from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { assertBearerTokens, isRefreshGrantRejected, tokensWithExpiresAt } from "./exchange";

describe("OAuth token validation", () => {
	it("accepts bearer token types case-insensitively", () => {
		expect(() => assertBearerTokens({ access_token: "token", token_type: "Bearer" })).not.toThrow();
		expect(() => assertBearerTokens({ access_token: "token", token_type: "bearer" })).not.toThrow();
	});

	it("rejects token types MCP cannot send", () => {
		expect(() => assertBearerTokens({ access_token: "token", token_type: "DPoP" })).toThrow(
			/Unsupported OAuth token type/
		);
	});

	it("converts expires_in to an absolute millisecond timestamp", () => {
		const before = Date.now();
		const tokens = tokensWithExpiresAt({
			access_token: "token",
			token_type: "Bearer",
			expires_in: 60,
		});
		expect(tokens.expires_at).toBeGreaterThanOrEqual(before + 60_000);
		expect(tokens.expires_at).toBeLessThanOrEqual(Date.now() + 60_000);
	});
});

describe("refresh rejection classification", () => {
	it("treats only invalid_grant as a rejected refresh credential", () => {
		expect(isRefreshGrantRejected(new InvalidGrantError(""))).toBe(true);
		expect(isRefreshGrantRejected(new InvalidRequestError("invalid request"))).toBe(false);
		expect(isRefreshGrantRejected(new ServerError("unavailable"))).toBe(false);
		expect(isRefreshGrantRejected(new Error("invalid_grant"))).toBe(false);
	});
});
