import { describe, it, expect } from "vitest";
import { sanitizeJsonSchema } from "./tools";

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
