import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sanitizeJsonSchema, getOpenAiToolsForMcp, resetMcpToolsCache } from "./tools";
import type { McpServerConfig } from "./httpClient";

// In-memory MCP servers keyed by URL: each listTools call is recorded so tests
// can assert exactly which servers were (re-)listed vs served from the cache.
const mcpMock = vi.hoisted(() => ({
	listToolsCalls: [] as string[],
	responses: new Map<string, { tools: unknown[] } | Error>(),
}));

vi.mock("@modelcontextprotocol/sdk/client", () => ({
	Client: class {
		private url = "";
		async connect(transport: { url?: unknown }) {
			this.url = String(transport.url ?? "");
		}
		async listTools() {
			mcpMock.listToolsCalls.push(this.url);
			const response = mcpMock.responses.get(this.url);
			if (!response) return { tools: [] };
			if (response instanceof Error) throw response;
			return response;
		}
		async close() {}
	},
}));

vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
	StreamableHTTPClientTransport: class {
		url: unknown;
		constructor(url: unknown) {
			this.url = url;
		}
	},
}));

vi.mock("@modelcontextprotocol/sdk/client/sse.js", () => ({
	SSEClientTransport: class {
		url: unknown;
		constructor(url: unknown) {
			this.url = url;
		}
	},
}));

// The real `write_file` inputSchema served today by hf.co/mcp. The properties
// `private`, `revision`, `commit_message`, `commit_description` are shaped
// `{ description, default: null }` with NO `type`, which strict providers
// (Fireworks) reject under tool_choice:"auto" — taking down the whole tools array.
const writeFileSchema: Record<string, unknown> = {
	$schema: "http://json-schema.org/draft-07/schema#",
	additionalProperties: false,
	type: "object",
	required: ["content", "repo_id", "path_in_repo"],
	properties: {
		content: { description: "String content to write to the Hub.", type: "string" },
		repo_id: { description: "Hub repo id, or bucket id when repo_type is bucket.", type: "string" },
		path_in_repo: { description: "File path to create in the repo.", type: "string" },
		repo_type: {
			default: "model",
			description: "Repository type.",
			enum: ["model", "dataset", "space", "bucket"],
			type: "string",
		},
		create_pr: {
			default: false,
			description: "Open repo uploads as a pull request.",
			type: "boolean",
		},
		// the four offenders: no `type`, `default: null`
		private: { default: null, description: "Optional privacy setting." },
		revision: { default: null, description: "Branch or revision for repo uploads." },
		commit_message: { default: null, description: "Optional commit message." },
		commit_description: { default: null, description: "Optional commit description." },
	},
};

describe("sanitizeJsonSchema", () => {
	it("adds a `type` to type-less properties and drops their null defaults", () => {
		const out = sanitizeJsonSchema(writeFileSchema);
		const props = out.properties as Record<string, Record<string, unknown>>;
		for (const key of ["private", "revision", "commit_message", "commit_description"]) {
			expect(props[key].type).toBe("string");
			expect("default" in props[key]).toBe(false);
		}
	});

	it("leaves typed/enum properties and non-null defaults untouched", () => {
		const out = sanitizeJsonSchema(writeFileSchema);
		const props = out.properties as Record<string, Record<string, unknown>>;
		expect(props.repo_id).toEqual({
			description: "Hub repo id, or bucket id when repo_type is bucket.",
			type: "string",
		});
		expect(props.repo_type.enum).toEqual(["model", "dataset", "space", "bucket"]);
		expect(props.repo_type.type).toBe("string");
		expect(props.repo_type.default).toBe("model");
		expect(props.create_pr.default).toBe(false);
		expect(props.create_pr.type).toBe("boolean");
	});

	it("preserves boolean additionalProperties and the required array", () => {
		const out = sanitizeJsonSchema(writeFileSchema);
		expect(out.additionalProperties).toBe(false);
		expect(out.required).toEqual(["content", "repo_id", "path_in_repo"]);
		expect(out.type).toBe("object");
	});

	it("leaves an empty {} property as match-anything (hf.co/mcp store_files `files`)", () => {
		const out = sanitizeJsonSchema({ type: "object", properties: { files: {} } });
		const props = out.properties as Record<string, Record<string, unknown>>;
		expect(props.files).toEqual({});
	});

	it("preserves an arbitrary additionalProperties map (hf.co/mcp `hf_jobs.args`)", () => {
		const out = sanitizeJsonSchema({
			type: "object",
			properties: {
				args: { type: "object", description: "Args as a JSON object", additionalProperties: {} },
			},
		});
		const props = out.properties as Record<string, Record<string, unknown>>;
		// must NOT be narrowed to { type: "string" } — that would reject non-string values
		expect(props.args.additionalProperties).toEqual({});
	});

	it("infers object (not string) for patternProperties maps and sanitizes their sub-schemas", () => {
		const out = sanitizeJsonSchema({
			patternProperties: { "^x-": { default: null, description: "header value" } },
		});
		expect(out.type).toBe("object");
		const pp = out.patternProperties as Record<string, Record<string, unknown>>;
		expect(pp["^x-"].type).toBe("string");
		expect("default" in pp["^x-"]).toBe(false);
	});

	it("infers object for a schema defined only via additionalProperties", () => {
		const out = sanitizeJsonSchema({ additionalProperties: { type: "string" } });
		expect(out.type).toBe("object");
		expect(out.additionalProperties).toEqual({ type: "string" });
	});

	it("recurses into nested object properties and array items", () => {
		const out = sanitizeJsonSchema({
			type: "object",
			properties: {
				nested: { type: "object", properties: { inner: { default: null, description: "x" } } },
				list: { type: "array", items: { default: null, description: "y" } },
			},
		});
		const props = out.properties as Record<string, Record<string, unknown>>;
		const inner = (props.nested.properties as Record<string, Record<string, unknown>>).inner;
		expect(inner.type).toBe("string");
		expect("default" in inner).toBe(false);
		expect((props.list.items as Record<string, unknown>).type).toBe("string");
	});

	it("does not coerce a node that already implies a type via combinators", () => {
		const out = sanitizeJsonSchema({
			type: "object",
			properties: { choice: { anyOf: [{ type: "string" }, { type: "number" }] } },
		});
		const props = out.properties as Record<string, Record<string, unknown>>;
		expect("type" in props.choice).toBe(false);
	});

	it("is idempotent", () => {
		const once = sanitizeJsonSchema(writeFileSchema);
		const twice = sanitizeJsonSchema(once);
		expect(twice).toEqual(once);
	});

	it("does not mutate the input", () => {
		const before = JSON.stringify(writeFileSchema);
		sanitizeJsonSchema(writeFileSchema);
		expect(JSON.stringify(writeFileSchema)).toBe(before);
	});
});

const SERVER_A: McpServerConfig = { name: "Server A", url: "https://a.example/mcp" };
const SERVER_B: McpServerConfig = { name: "Server B", url: "https://b.example/mcp" };

const searchTool = {
	name: "search",
	description: "Search things",
	inputSchema: { type: "object", properties: { q: { type: "string" } } },
};
const fetchTool = {
	name: "fetch_page",
	description: "Fetch a page",
	inputSchema: { type: "object", properties: { url: { type: "string" } } },
};

describe("getOpenAiToolsForMcp per-server cache", () => {
	beforeEach(() => {
		resetMcpToolsCache();
		mcpMock.listToolsCalls.length = 0;
		mcpMock.responses.clear();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("serves repeat requests from the cache instead of re-listing", async () => {
		mcpMock.responses.set(SERVER_A.url, { tools: [searchTool] });

		const first = await getOpenAiToolsForMcp([SERVER_A]);
		const second = await getOpenAiToolsForMcp([SERVER_A]);

		expect(mcpMock.listToolsCalls).toEqual([SERVER_A.url]);
		expect(first.tools.map((t) => t.function.name)).toEqual(["search"]);
		expect(first.tools[0].function.parameters).toMatchObject({ type: "object" });
		expect(second.tools.map((t) => t.function.name)).toEqual(["search"]);
		expect(second.mapping.search).toEqual({
			fnName: "search",
			server: "Server A",
			tool: "search",
		});
	});

	it("fetches only servers missing from the cache when the selection grows", async () => {
		mcpMock.responses.set(SERVER_A.url, { tools: [searchTool] });
		mcpMock.responses.set(SERVER_B.url, { tools: [fetchTool] });

		await getOpenAiToolsForMcp([SERVER_A]);
		const merged = await getOpenAiToolsForMcp([SERVER_A, SERVER_B]);

		expect(mcpMock.listToolsCalls).toEqual([SERVER_A.url, SERVER_B.url]);
		expect(merged.tools.map((t) => t.function.name)).toEqual(["search", "fetch_page"]);
	});

	it("re-lists a server after its entry expires", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-06-11T12:00:00Z"));
		mcpMock.responses.set(SERVER_A.url, { tools: [searchTool] });

		await getOpenAiToolsForMcp([SERVER_A]);
		vi.setSystemTime(new Date("2026-06-11T12:01:01Z")); // past the 60s TTL
		await getOpenAiToolsForMcp([SERVER_A]);

		expect(mcpMock.listToolsCalls).toEqual([SERVER_A.url, SERVER_A.url]);
	});

	it("does not cache a failed listing and retries it on the next request", async () => {
		mcpMock.responses.set(SERVER_A.url, new Error("boom"));
		mcpMock.responses.set(SERVER_B.url, { tools: [fetchTool] });

		const first = await getOpenAiToolsForMcp([SERVER_A, SERVER_B]);
		expect(first.tools.map((t) => t.function.name)).toEqual(["fetch_page"]);

		mcpMock.responses.set(SERVER_A.url, { tools: [searchTool] });
		const second = await getOpenAiToolsForMcp([SERVER_A, SERVER_B]);

		expect(second.tools.map((t) => t.function.name)).toEqual(["search", "fetch_page"]);
		// A listed twice (failure not cached), B listed once (success cached)
		expect(mcpMock.listToolsCalls.filter((u) => u === SERVER_A.url)).toHaveLength(2);
		expect(mcpMock.listToolsCalls.filter((u) => u === SERVER_B.url)).toHaveLength(1);
	});

	it("keys entries by headers so per-user auth does not share a cache entry", async () => {
		mcpMock.responses.set(SERVER_A.url, { tools: [searchTool] });
		const asUser1 = { ...SERVER_A, headers: { Authorization: "Bearer hf_user1" } };
		const asUser2 = { ...SERVER_A, headers: { Authorization: "Bearer hf_user2" } };

		await getOpenAiToolsForMcp([asUser1]);
		await getOpenAiToolsForMcp([asUser2]);
		await getOpenAiToolsForMcp([asUser1]);

		expect(mcpMock.listToolsCalls).toEqual([SERVER_A.url, SERVER_A.url]);
	});

	it("hits the cache when only the display name changes, mapping to the new name", async () => {
		mcpMock.responses.set(SERVER_A.url, { tools: [searchTool] });

		await getOpenAiToolsForMcp([SERVER_A]);
		const renamed = await getOpenAiToolsForMcp([{ ...SERVER_A, name: "Renamed" }]);

		expect(mcpMock.listToolsCalls).toEqual([SERVER_A.url]);
		expect(renamed.mapping.search?.server).toBe("Renamed");
	});

	it("suffixes colliding tool names with the server name", async () => {
		mcpMock.responses.set(SERVER_A.url, { tools: [searchTool] });
		mcpMock.responses.set(SERVER_B.url, { tools: [searchTool] });

		const { tools, mapping } = await getOpenAiToolsForMcp([SERVER_A, SERVER_B]);

		expect(tools.map((t) => t.function.name)).toEqual(["search", "search_Server_B"]);
		expect(mapping.search.server).toBe("Server A");
		expect(mapping.search_Server_B.server).toBe("Server B");
	});
});
