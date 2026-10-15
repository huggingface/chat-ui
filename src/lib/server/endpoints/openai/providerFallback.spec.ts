import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("$lib/server/logger", () => ({ logger: { warn: vi.fn() } }));

import { fetchWithProviderFallback, upstreamErrorCode } from "./providerFallback";

const URL_ = "https://router.example/v1/chat/completions";

function respond(...statuses: number[]) {
	const fetchMock = vi.fn(async () => {
		const status = statuses.shift() ?? 200;
		return new Response(status === 200 ? "{}" : '{"error":"payment required"}', {
			status,
			headers: status === 402 ? { "x-error-code": "PayAsYouGoNotEnabled" } : {},
		});
	});
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

function sentModels(fetchMock: ReturnType<typeof respond>): string[] {
	return fetchMock.mock.calls.map(
		(call) => JSON.parse((call as unknown as [string, RequestInit])[1].body as string).model
	);
}

const body = (model: string) => JSON.stringify({ model, messages: [], stream: true });

describe("fetchWithProviderFallback", () => {
	afterEach(() => vi.unstubAllGlobals());

	it("retries a pinned-provider 402 on the bare model id", async () => {
		const fetchMock = respond(402, 200);
		const res = await fetchWithProviderFallback(URL_, {
			method: "POST",
			body: body("zai-org/GLM-5.3-Flash:together"),
		});
		expect(res.status).toBe(200);
		expect(sentModels(fetchMock)).toEqual([
			"zai-org/GLM-5.3-Flash:together",
			"zai-org/GLM-5.3-Flash",
		]);
	});

	it("surfaces the retry's 402 when auto is refused too", async () => {
		const fetchMock = respond(402, 402);
		const res = await fetchWithProviderFallback(URL_, {
			method: "POST",
			body: body("zai-org/GLM-5.3-Flash:together"),
		});
		expect(res.status).toBe(402);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("does not retry an unpinned 402", async () => {
		const fetchMock = respond(402);
		const res = await fetchWithProviderFallback(URL_, {
			method: "POST",
			body: body("zai-org/GLM-5.3-Flash"),
		});
		expect(res.status).toBe(402);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("does not retry other errors", async () => {
		const fetchMock = respond(500);
		const res = await fetchWithProviderFallback(URL_, {
			method: "POST",
			body: body("zai-org/GLM-5.3-Flash:together"),
		});
		expect(res.status).toBe(500);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("keeps the rest of the body", async () => {
		const fetchMock = respond(402, 200);
		await fetchWithProviderFallback(URL_, {
			method: "POST",
			body: JSON.stringify({ model: "a/b:together", messages: [{ role: "user", content: "hi" }] }),
		});
		const retried = JSON.parse(
			(fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].body as string
		);
		expect(retried).toEqual({ model: "a/b", messages: [{ role: "user", content: "hi" }] });
	});
});

describe("upstreamErrorCode", () => {
	it("reads the SDK's lowercase header record", () => {
		expect(
			upstreamErrorCode({ status: 402, headers: { "x-error-code": "PrepaidCreditsRequired" } })
		).toBe("PrepaidCreditsRequired");
	});

	it("reads a Headers instance and a kept errorCode", () => {
		expect(
			upstreamErrorCode({ headers: new Headers({ "X-Error-Code": "PayAsYouGoNotEnabled" }) })
		).toBe("PayAsYouGoNotEnabled");
		expect(upstreamErrorCode({ errorCode: "BillingAccountProvisioning" })).toBe(
			"BillingAccountProvisioning"
		);
	});

	it("is undefined without a code", () => {
		expect(upstreamErrorCode(new Error("boom"))).toBeUndefined();
	});
});
