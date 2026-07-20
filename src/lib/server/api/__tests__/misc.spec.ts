import { describe, it, expect, beforeEach } from "vitest";
import superjson from "superjson";
import { collections, ready } from "$lib/server/database";
import { createTestLocals, createTestUser, cleanupTestData } from "./testHelpers";
import { testRequest } from "$lib/server/__tests__/testRequest";
import { GET as featureFlagsGET } from "../../../../routes/api/v2/feature-flags/+server";
import { GET as publicConfigGET } from "../../../../routes/api/v2/public-config/+server";
import type { FeatureFlags } from "$lib/server/api/types";

async function parseResponse<T = unknown>(res: Response): Promise<T> {
	return superjson.parse(await res.text()) as T;
}

describe("GET /api/v2/feature-flags", () => {
	beforeEach(async () => {
		await ready;
		await cleanupTestData();
	}, 20000);

	it("returns correct shape with expected fields", async () => {
		const locals = createTestLocals();

		const res = await testRequest(featureFlagsGET, { path: "/api/v2/feature-flags", locals });
		const data = await parseResponse<FeatureFlags>(res);

		expect(data).toHaveProperty("enableAssistants");
		expect(data).toHaveProperty("loginEnabled");
		expect(data).toHaveProperty("isAdmin");
		expect(data).toHaveProperty("transcriptionEnabled");
		expect(typeof data.enableAssistants).toBe("boolean");
		expect(typeof data.loginEnabled).toBe("boolean");
		expect(typeof data.isAdmin).toBe("boolean");
		expect(typeof data.transcriptionEnabled).toBe("boolean");
	});

	it("reflects isAdmin from locals for non-admin user", async () => {
		const locals = createTestLocals({ isAdmin: false });

		const res = await testRequest(featureFlagsGET, { path: "/api/v2/feature-flags", locals });
		const data = await parseResponse<FeatureFlags>(res);

		expect(data.isAdmin).toBe(false);
	});

	it("reflects isAdmin from locals for admin user", async () => {
		const { locals } = await createTestUser();
		locals.isAdmin = true;

		const res = await testRequest(featureFlagsGET, { path: "/api/v2/feature-flags", locals });
		const data = await parseResponse<FeatureFlags>(res);

		expect(data.isAdmin).toBe(true);
	});

	it("derives isAdmin from the persisted user under real cookie auth", async () => {
		const { user, cookie } = await createTestUser();
		await collections.users.updateOne({ _id: user._id }, { $set: { isAdmin: true } });

		const res = await testRequest(featureFlagsGET, {
			path: "/api/v2/feature-flags",
			headers: { cookie },
		});
		const data = await parseResponse<FeatureFlags>(res);

		expect(data.isAdmin).toBe(true);
	});

	it("serves CORS headers on /api/** when the request carries no Origin", async () => {
		const res = await testRequest(featureFlagsGET, {
			path: "/api/v2/feature-flags",
			locals: createTestLocals(),
		});

		expect(res.headers.get("access-control-allow-origin")).toBe("*");
		expect(res.headers.get("access-control-allow-methods")).toBe(
			"GET, POST, PUT, PATCH, DELETE, OPTIONS"
		);
		expect(res.headers.get("access-control-allow-headers")).toBe("Content-Type, Authorization");
	});
});

const publicConfigRequest = () =>
	testRequest(publicConfigGET, { path: "/api/v2/public-config", locals: createTestLocals() });

describe("GET /api/v2/public-config", () => {
	it("exposes only PUBLIC_-prefixed keys", async () => {
		const res = await publicConfigRequest();
		const data = await parseResponse<Record<string, unknown>>(res);

		const keys = Object.keys(data);
		expect(keys.length).toBeGreaterThan(0);

		const leaked = keys.filter((key) => !key.startsWith("PUBLIC_"));
		expect(leaked).toEqual([]);
	});

	it("never leaks server-only secrets", async () => {
		const res = await publicConfigRequest();
		const data = await parseResponse<Record<string, unknown>>(res);

		for (const secret of [
			"OPENAI_API_KEY",
			"HF_TOKEN",
			"MONGODB_URL",
			"OPENID_CLIENT_SECRET",
			"ADMIN_API_SECRET",
			"ADMIN_TOKEN",
			"EXA_API_KEY",
			"PARQUET_EXPORT_HF_TOKEN",
		]) {
			expect(data).not.toHaveProperty(secret);
		}

		const suspicious = Object.entries(data).filter(
			([, value]) => typeof value === "string" && /^(hf_|sk-)/.test(value)
		);
		expect(suspicious).toEqual([]);
	});

	it("serves known public config with a private cache header", async () => {
		const res = await publicConfigRequest();
		const data = await parseResponse<Record<string, unknown>>(res);

		expect(data).toHaveProperty("PUBLIC_APP_NAME");
		expect(typeof data.PUBLIC_APP_NAME).toBe("string");

		expect(res.headers.get("Cache-Control")).toBe("private, max-age=60");
	});
});
