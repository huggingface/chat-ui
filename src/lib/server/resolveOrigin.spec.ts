import { describe, expect, it, vi } from "vitest";

const mockConfig: { PUBLIC_ORIGIN: string } = { PUBLIC_ORIGIN: "" };

vi.mock("$lib/server/config", () => ({
	config: mockConfig,
}));

const { resolveExternalOrigin } = await import("./resolveOrigin");

describe("resolveExternalOrigin", () => {
	it("falls back to the request's own origin when PUBLIC_ORIGIN is unset", () => {
		mockConfig.PUBLIC_ORIGIN = "";

		expect(resolveExternalOrigin(new URL("https://proxy.internal/login"))).toBe(
			"https://proxy.internal"
		);
	});

	it("prefers PUBLIC_ORIGIN over the request's own origin when set", () => {
		// Regression test for #2489: SvelteKit's node adapter renders `url.origin` as
		// `https://` in production builds regardless of the actual inbound protocol, so a
		// deployment served over plain HTTP needs PUBLIC_ORIGIN to produce a correct,
		// http:// OAuth callback URI.
		mockConfig.PUBLIC_ORIGIN = "http://mylocaldocker.internal:5173";

		expect(resolveExternalOrigin(new URL("https://mylocaldocker.internal:5173/login"))).toBe(
			"http://mylocaldocker.internal:5173"
		);
	});

	it("prefers PUBLIC_ORIGIN even when it differs from the request host entirely", () => {
		// e.g. a reverse proxy or Docker port mapping where the app-visible request URL
		// doesn't match what the outside world (and the OIDC provider) actually sees.
		mockConfig.PUBLIC_ORIGIN = "https://chat.example.com";

		expect(resolveExternalOrigin(new URL("http://127.0.0.1:3000/login"))).toBe(
			"https://chat.example.com"
		);
	});

	it("strips a trailing slash from PUBLIC_ORIGIN", () => {
		// A trailing slash is a common way to represent a public URL. Left as-is, it
		// would survive into `${origin}${base}/login/callback` as a double slash that
		// doesn't match the OAuth redirect URI registered with the provider.
		mockConfig.PUBLIC_ORIGIN = "https://chat.example.com/";

		expect(resolveExternalOrigin(new URL("http://127.0.0.1:3000/login"))).toBe(
			"https://chat.example.com"
		);
	});

	it("strips any path/query someone pastes into PUBLIC_ORIGIN by mistake", () => {
		mockConfig.PUBLIC_ORIGIN = "https://chat.example.com/some/path?x=1";

		expect(resolveExternalOrigin(new URL("http://127.0.0.1:3000/login"))).toBe(
			"https://chat.example.com"
		);
	});

	it("falls back to a trailing-slash trim when PUBLIC_ORIGIN isn't a parseable URL", () => {
		// Doesn't throw and doesn't silently break the OAuth flow on a malformed config
		// value -- degrades to the same trailing-slash fix on a best-effort basis.
		mockConfig.PUBLIC_ORIGIN = "not-a-valid-url/";

		expect(resolveExternalOrigin(new URL("http://127.0.0.1:3000/login"))).toBe("not-a-valid-url");
	});
});
