import { describe, it, expect, vi, beforeEach } from "vitest";
import { listMcpResources, readMcpResource } from "./resources";
import type { McpServerConfig } from "./httpClient";
import type { ServerCatalog } from "./tools";

const mocks = vi.hoisted(() => ({
	catalogs: [] as unknown[],
	readsBy: [] as string[],
	readResource: async (_params: { uri: string }): Promise<unknown> => ({ contents: [] }),
}));

vi.mock("./tools", () => ({ getMcpCatalog: async () => mocks.catalogs }));

vi.mock("./clientPool", () => ({
	getClient: async (server: McpServerConfig) => ({
		readResource: (params: { uri: string }) => {
			mocks.readsBy.push(server.name);
			return mocks.readResource(params);
		},
	}),
	retainClient: () => {},
	releaseClient: () => {},
	evictFromPool: () => undefined,
}));

vi.mock("./httpClient", () => ({
	getMcpToolTimeoutMs: () => 1_000,
	isConnectionClosedError: () => false,
	isSessionExpiredError: () => false,
}));

vi.mock("$lib/server/logger", () => ({
	logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
}));

const SERVER_A: McpServerConfig = { name: "Docs", url: "https://a.example/mcp" };
const SERVER_B: McpServerConfig = { name: "Files", url: "https://b.example/mcp" };

const empty: ServerCatalog = { tools: [], resources: [], templates: [] };

function catalog(partial: Partial<ServerCatalog>): ServerCatalog {
	return { ...empty, ...partial };
}

beforeEach(() => {
	mocks.catalogs = [];
	mocks.readsBy.length = 0;
	mocks.readResource = async () => ({ contents: [] });
});

describe("listMcpResources", () => {
	it("says so plainly when nothing is exposed", async () => {
		mocks.catalogs = [empty];

		expect(await listMcpResources([SERVER_A])).toBe(
			"No resources are exposed by the connected MCP servers."
		);
	});

	it("renders each resource with its URI, name, type, owning server and description", async () => {
		mocks.catalogs = [
			catalog({
				resources: [
					{
						uri: "file:///readme.md",
						name: "readme",
						mimeType: "text/markdown",
						description: "Project overview",
					},
				],
			}),
		];

		const listing = await listMcpResources([SERVER_A]);

		expect(listing).toContain("Available MCP resources (1):");
		expect(listing).toContain(
			"- file:///readme.md | name: readme | type: text/markdown | server: Docs"
		);
		expect(listing).toContain("Project overview");
	});

	it("labels each resource with the server it came from", async () => {
		mocks.catalogs = [
			catalog({ resources: [{ uri: "doc://a" }] }),
			catalog({ resources: [{ uri: "file:///b" }] }),
		];

		const listing = await listMcpResources([SERVER_A, SERVER_B]);

		expect(listing).toContain("- doc://a | server: Docs");
		expect(listing).toContain("- file:///b | server: Files");
	});

	it("lists URI templates in their own section", async () => {
		mocks.catalogs = [
			catalog({ templates: [{ uriTemplate: "file:///{path}", name: "project file" }] }),
		];

		const listing = await listMcpResources([SERVER_A]);

		expect(listing).toContain("Resource URI templates");
		expect(listing).toContain("- file:///{path} | name: project file | server: Docs");
	});

	it("caps the listing and reports the total it was drawn from", async () => {
		mocks.catalogs = [
			catalog({
				resources: Array.from({ length: 250 }, (_, i) => ({ uri: `doc://${i}` })),
			}),
		];

		const listing = await listMcpResources([SERVER_A]);

		expect(listing).toContain("Available MCP resources (200 of 250 shown):");
		expect(listing).toContain("doc://199");
		expect(listing).not.toContain("doc://200 ");
	});
});

describe("readMcpResource", () => {
	it("routes a URI to the server that enumerated it", async () => {
		mocks.catalogs = [
			catalog({ resources: [{ uri: "doc://a" }] }),
			catalog({ resources: [{ uri: "file:///b" }] }),
		];
		mocks.readResource = async () => ({ contents: [{ uri: "file:///b", text: "hello" }] });

		const result = await readMcpResource([SERVER_A, SERVER_B], "file:///b");

		expect(result).toEqual({ text: "hello", isError: false });
		expect(mocks.readsBy).toEqual(["Files"]);
	});

	it("routes an unenumerated URI via a matching template", async () => {
		mocks.catalogs = [
			catalog({ resources: [{ uri: "doc://a" }] }),
			catalog({ templates: [{ uriTemplate: "file:///{path}" }] }),
		];
		mocks.readResource = async () => ({ contents: [{ text: "from template" }] });

		const result = await readMcpResource([SERVER_A, SERVER_B], "file:///deep/nested.md");

		expect(result.isError).toBe(false);
		expect(mocks.readsBy).toEqual(["Files"]);
	});

	it("reports an unresolvable URI without contacting any server", async () => {
		mocks.catalogs = [catalog({ resources: [{ uri: "doc://a" }] })];

		const result = await readMcpResource([SERVER_A], "file:///nope.md");

		expect(result.isError).toBe(true);
		expect(result.text).toContain("No connected MCP server exposes");
		expect(mocks.readsBy).toEqual([]);
	});

	it("does not let a template match a URI of a different shape", async () => {
		mocks.catalogs = [catalog({ templates: [{ uriTemplate: "file:///{path}" }] })];

		const result = await readMcpResource([SERVER_A], "https://example.com/x");

		expect(result.isError).toBe(true);
		expect(mocks.readsBy).toEqual([]);
	});

	it("rejects a missing uri argument before resolving anything", async () => {
		mocks.catalogs = [catalog({ resources: [{ uri: "doc://a" }] })];

		expect(await readMcpResource([SERVER_A], "")).toEqual({
			text: "A `uri` argument is required.",
			isError: true,
		});
	});

	it("joins multiple text contents", async () => {
		mocks.catalogs = [catalog({ resources: [{ uri: "doc://a" }] })];
		mocks.readResource = async () => ({ contents: [{ text: "one" }, { text: "two" }] });

		expect((await readMcpResource([SERVER_A], "doc://a")).text).toBe("one\n\ntwo");
	});

	it("describes binary content instead of inlining it", async () => {
		mocks.catalogs = [catalog({ resources: [{ uri: "doc://a" }] })];
		const blob = "A".repeat(4_000);
		mocks.readResource = async () => ({ contents: [{ mimeType: "image/png", blob }] });

		const result = await readMcpResource([SERVER_A], "doc://a");

		expect(result.isError).toBe(false);
		expect(result.text).toBe("[Binary content: image/png, ~3000 bytes, not inlined.]");
		expect(result.text).not.toContain(blob);
	});

	it("truncates an oversized resource and says how much was withheld", async () => {
		mocks.catalogs = [catalog({ resources: [{ uri: "doc://a" }] })];
		mocks.readResource = async () => ({ contents: [{ text: "x".repeat(40_000) }] });

		const result = await readMcpResource([SERVER_A], "doc://a");

		expect(result.isError).toBe(false);
		expect(result.text).toContain("[Truncated: the resource is 40000 characters, 32000 shown.]");
	});

	it("reports an empty read as empty rather than as a failure", async () => {
		mocks.catalogs = [catalog({ resources: [{ uri: "doc://a" }] })];
		mocks.readResource = async () => ({ contents: [] });

		expect(await readMcpResource([SERVER_A], "doc://a")).toEqual({
			text: 'The resource "doc://a" returned no readable content.',
			isError: false,
		});
	});
});

describe("readMcpResource ambiguity", () => {
	const shared = { uri: "file:///readme.md" };

	it("refuses to guess when two servers expose the same URI", async () => {
		mocks.catalogs = [catalog({ resources: [shared] }), catalog({ resources: [shared] })];

		const result = await readMcpResource([SERVER_A, SERVER_B], "file:///readme.md");

		expect(result.isError).toBe(true);
		expect(result.text).toContain('"Docs", "Files"');
		expect(mocks.readsBy).toEqual([]);
	});

	it("reads the named server when the caller disambiguates", async () => {
		mocks.catalogs = [catalog({ resources: [shared] }), catalog({ resources: [shared] })];
		mocks.readResource = async () => ({ contents: [{ text: "from Files" }] });

		const result = await readMcpResource([SERVER_A, SERVER_B], "file:///readme.md", {
			server: "Files",
		});

		expect(result).toEqual({ text: "from Files", isError: false });
		expect(mocks.readsBy).toEqual(["Files"]);
	});

	it("reports a server argument that does not expose the URI", async () => {
		mocks.catalogs = [catalog({ resources: [shared] }), catalog({})];

		const result = await readMcpResource([SERVER_A, SERVER_B], "file:///readme.md", {
			server: "Files",
		});

		expect(result.isError).toBe(true);
		expect(result.text).toContain('"Files" does not expose');
		expect(mocks.readsBy).toEqual([]);
	});
});

describe("listMcpResources template cap", () => {
	it("caps templates and reports the total", async () => {
		mocks.catalogs = [
			catalog({
				templates: Array.from({ length: 80 }, (_, i) => ({ uriTemplate: `doc://{id}/${i}` })),
			}),
		];

		const listing = await listMcpResources([SERVER_A]);

		expect(listing).toContain("Resource URI templates (50 of 80 shown;");
		expect(listing).toContain("doc://{id}/49");
		expect(listing).not.toContain("doc://{id}/50 ");
	});
});
