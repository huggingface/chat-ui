import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import worker, { isSafeTargetUrl, type Env } from "./index";

const SECRET = "test-secret-value";

function makeEnv(overrides: Partial<Env> = {}): Env {
	return {
		FETCH_PROXY_SECRET: SECRET,
		MAX_RESPONSE_BYTES: "1024",
		FETCH_TIMEOUT_MS: "5000",
		MAX_REDIRECTS: "3",
		...overrides,
	};
}

function makeRequest(path: string, init: RequestInit = {}) {
	return new Request(`https://proxy.example.com${path}`, init);
}

describe("isSafeTargetUrl", () => {
	it("accepts public HTTPS URLs", () => {
		expect(isSafeTargetUrl("https://example.com/file.png")).toBe(true);
		expect(isSafeTargetUrl("https://sub.example.co.uk:8443/path")).toBe(true);
	});

	it("rejects non-HTTPS schemes", () => {
		expect(isSafeTargetUrl("http://example.com")).toBe(false);
		expect(isSafeTargetUrl("ftp://example.com")).toBe(false);
		expect(isSafeTargetUrl("file:///etc/passwd")).toBe(false);
		expect(isSafeTargetUrl("javascript:alert(1)")).toBe(false);
	});

	it("rejects localhost variants", () => {
		expect(isSafeTargetUrl("https://localhost")).toBe(false);
		expect(isSafeTargetUrl("https://foo.localhost")).toBe(false);
		expect(isSafeTargetUrl("https://foo.local")).toBe(false);
		expect(isSafeTargetUrl("https://svc.internal")).toBe(false);
	});

	it("rejects raw IPv4 literals", () => {
		expect(isSafeTargetUrl("https://127.0.0.1")).toBe(false);
		expect(isSafeTargetUrl("https://10.0.0.1")).toBe(false);
		expect(isSafeTargetUrl("https://192.168.1.1")).toBe(false);
		expect(isSafeTargetUrl("https://8.8.8.8")).toBe(false); // IP literal, even if public
	});

	it("rejects raw IPv6 literals", () => {
		expect(isSafeTargetUrl("https://[::1]")).toBe(false);
		expect(isSafeTargetUrl("https://[2001:db8::1]")).toBe(false);
	});

	it("rejects unparseable input", () => {
		expect(isSafeTargetUrl("not a url")).toBe(false);
		expect(isSafeTargetUrl("")).toBe(false);
	});
});

describe("worker fetch handler", () => {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let fetchSpy: any;

	beforeEach(() => {
		fetchSpy = vi.spyOn(globalThis, "fetch");
	});

	afterEach(() => {
		fetchSpy.mockRestore();
	});

	it("returns 200 on /health without auth", async () => {
		const res = await worker.fetch(makeRequest("/health"), makeEnv());
		expect(res.status).toBe(200);
		expect(await res.text()).toBe("ok");
	});

	it("returns 404 for unknown paths", async () => {
		const res = await worker.fetch(makeRequest("/nope"), makeEnv());
		expect(res.status).toBe(404);
	});

	it("rejects requests without secret", async () => {
		const res = await worker.fetch(makeRequest("/fetch?url=https%3A%2F%2Fexample.com"), makeEnv());
		expect(res.status).toBe(401);
	});

	it("rejects requests with wrong secret", async () => {
		const res = await worker.fetch(
			makeRequest("/fetch?url=https%3A%2F%2Fexample.com", {
				headers: { "X-Proxy-Secret": "wrong" },
			}),
			makeEnv()
		);
		expect(res.status).toBe(401);
	});

	it("rejects missing url parameter", async () => {
		const res = await worker.fetch(
			makeRequest("/fetch", { headers: { "X-Proxy-Secret": SECRET } }),
			makeEnv()
		);
		expect(res.status).toBe(400);
	});

	it("rejects unsafe URLs", async () => {
		const res = await worker.fetch(
			makeRequest("/fetch?url=http%3A%2F%2Flocalhost", {
				headers: { "X-Proxy-Secret": SECRET },
			}),
			makeEnv()
		);
		expect(res.status).toBe(400);
	});

	it("fetches upstream and returns body with forwarded content type", async () => {
		fetchSpy.mockResolvedValueOnce(
			new Response("hello world", {
				status: 200,
				headers: { "content-type": "text/plain; charset=utf-8" },
			})
		);

		const res = await worker.fetch(
			makeRequest("/fetch?url=https%3A%2F%2Fexample.com%2Ffile.txt", {
				headers: { "X-Proxy-Secret": SECRET },
			}),
			makeEnv()
		);

		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("application/octet-stream");
		expect(res.headers.get("x-original-content-type")).toBe("text/plain; charset=utf-8");
		expect(res.headers.get("x-original-status")).toBe("200");
		expect(await res.text()).toBe("hello world");
	});

	it("passes through Content-Disposition", async () => {
		fetchSpy.mockResolvedValueOnce(
			new Response("data", {
				status: 200,
				headers: {
					"content-type": "application/pdf",
					"content-disposition": 'attachment; filename="doc.pdf"',
				},
			})
		);

		const res = await worker.fetch(
			makeRequest("/fetch?url=https%3A%2F%2Fexample.com%2Fdoc.pdf", {
				headers: { "X-Proxy-Secret": SECRET },
			}),
			makeEnv()
		);

		expect(res.headers.get("content-disposition")).toBe('attachment; filename="doc.pdf"');
	});

	it("rejects upstream responses larger than MAX_RESPONSE_BYTES via content-length", async () => {
		fetchSpy.mockResolvedValueOnce(
			new Response("x", {
				status: 200,
				headers: {
					"content-type": "application/octet-stream",
					"content-length": "99999999",
				},
			})
		);

		const res = await worker.fetch(
			makeRequest("/fetch?url=https%3A%2F%2Fexample.com%2Fbig", {
				headers: { "X-Proxy-Secret": SECRET },
			}),
			makeEnv()
		);

		expect(res.status).toBe(413);
	});

	it("rejects streamed bodies that exceed the byte cap", async () => {
		// 2000 bytes > 1024 cap, no content-length header
		const big = "a".repeat(2000);
		fetchSpy.mockResolvedValueOnce(
			new Response(big, {
				status: 200,
				headers: { "content-type": "text/plain" },
			})
		);

		const res = await worker.fetch(
			makeRequest("/fetch?url=https%3A%2F%2Fexample.com%2Fbig", {
				headers: { "X-Proxy-Secret": SECRET },
			}),
			makeEnv()
		);

		expect(res.status).toBe(413);
	});

	it("follows redirects up to MAX_REDIRECTS and revalidates each hop", async () => {
		fetchSpy
			.mockResolvedValueOnce(
				new Response(null, {
					status: 302,
					headers: { location: "https://example.com/step2" },
				})
			)
			.mockResolvedValueOnce(
				new Response("final", {
					status: 200,
					headers: { "content-type": "text/plain" },
				})
			);

		const res = await worker.fetch(
			makeRequest("/fetch?url=https%3A%2F%2Fexample.com%2Fstart", {
				headers: { "X-Proxy-Secret": SECRET },
			}),
			makeEnv()
		);

		expect(res.status).toBe(200);
		expect(await res.text()).toBe("final");
		expect(fetchSpy).toHaveBeenCalledTimes(2);
	});

	it("blocks redirects to unsafe URLs", async () => {
		fetchSpy.mockResolvedValueOnce(
			new Response(null, {
				status: 302,
				headers: { location: "http://localhost/secret" },
			})
		);

		const res = await worker.fetch(
			makeRequest("/fetch?url=https%3A%2F%2Fexample.com%2Fstart", {
				headers: { "X-Proxy-Secret": SECRET },
			}),
			makeEnv()
		);

		expect(res.status).toBe(403);
	});

	it("bails out after MAX_REDIRECTS hops", async () => {
		for (let i = 0; i < 10; i++) {
			fetchSpy.mockResolvedValueOnce(
				new Response(null, {
					status: 302,
					headers: { location: `https://example.com/hop${i}` },
				})
			);
		}

		const res = await worker.fetch(
			makeRequest("/fetch?url=https%3A%2F%2Fexample.com%2Fstart", {
				headers: { "X-Proxy-Secret": SECRET },
			}),
			makeEnv({ MAX_REDIRECTS: "2" })
		);

		expect(res.status).toBe(502);
	});

	it("maps upstream 4xx/5xx to the same status", async () => {
		fetchSpy.mockResolvedValueOnce(new Response("nope", { status: 404 }));

		const res = await worker.fetch(
			makeRequest("/fetch?url=https%3A%2F%2Fexample.com%2Fmissing", {
				headers: { "X-Proxy-Secret": SECRET },
			}),
			makeEnv()
		);

		expect(res.status).toBe(404);
	});
});
