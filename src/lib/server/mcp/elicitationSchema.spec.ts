import { describe, it, expect } from "vitest";
import { normalizeElicitationRequest, validateElicitationContent } from "./elicitationSchema";
import type { ElicitationField } from "$lib/types/McpElicitation";

const form = (properties: Record<string, unknown>, required?: string[]) => ({
	message: "Tell me about yourself",
	requestedSchema: { type: "object", properties, ...(required ? { required } : {}) },
});

const fieldsOf = (params: unknown): ElicitationField[] => {
	const result = normalizeElicitationRequest(params);
	if (!result.ok) throw new Error(`expected ok, got: ${result.reason}`);
	return result.payload.fields ?? [];
};

describe("normalizeElicitationRequest", () => {
	it("normalizes the primitive field types", () => {
		const fields = fieldsOf(
			form(
				{
					name: { type: "string", title: "Name", minLength: 2 },
					age: { type: "integer", minimum: 0 },
					score: { type: "number" },
					agree: { type: "boolean", default: true },
				},
				["name"]
			)
		);

		expect(fields).toEqual([
			{ kind: "string", name: "name", title: "Name", required: true, minLength: 2 },
			{ kind: "number", name: "age", required: false, integer: true, minimum: 0 },
			{ kind: "number", name: "score", required: false, integer: false },
			{ kind: "boolean", name: "agree", required: false, default: true },
		]);
	});

	it("reads every spelling of a single select the spec allows", () => {
		const [plain, legacy, titled] = fieldsOf(
			form({
				plain: { type: "string", enum: ["a", "b"] },
				legacy: { type: "string", enum: ["a", "b"], enumNames: ["Alpha", "Beta"] },
				titled: { type: "string", oneOf: [{ const: "a", title: "Alpha" }] },
			})
		);

		expect(plain).toMatchObject({
			kind: "select",
			multiple: false,
			options: [
				{ value: "a", label: "a" },
				{ value: "b", label: "b" },
			],
		});
		expect(legacy).toMatchObject({
			options: [
				{ value: "a", label: "Alpha" },
				{ value: "b", label: "Beta" },
			],
		});
		expect(titled).toMatchObject({ options: [{ value: "a", label: "Alpha" }] });
	});

	it("reads both spellings of a multi select", () => {
		const [plain, titled] = fieldsOf(
			form({
				plain: { type: "array", items: { type: "string", enum: ["a", "b"] }, maxItems: 1 },
				titled: { type: "array", items: { anyOf: [{ const: "a", title: "Alpha" }] } },
			})
		);

		expect(plain).toMatchObject({ kind: "select", multiple: true, maxItems: 1 });
		expect(titled).toMatchObject({ multiple: true, options: [{ value: "a", label: "Alpha" }] });
	});

	it("falls back to option values when the parallel label array does not line up", () => {
		// A mismatched enumNames would otherwise label an option with another one's name.
		const [field] = fieldsOf(
			form({ pick: { type: "string", enum: ["a", "b"], enumNames: ["Alpha"] } })
		);

		expect(field).toMatchObject({
			options: [
				{ value: "a", label: "a" },
				{ value: "b", label: "b" },
			],
		});
	});

	it("drops a default that is not one of the options", () => {
		const [field] = fieldsOf(form({ pick: { type: "string", enum: ["a"], default: "zzz" } }));

		expect(field).not.toHaveProperty("default");
	});

	it("rejects the whole request when one field cannot be rendered", () => {
		// Dropping it would hand the server an answer silently missing something it asked for.
		const result = normalizeElicitationRequest(
			form({ ok: { type: "string" }, nested: { type: "object" } })
		);

		expect(result).toMatchObject({ ok: false });
	});

	it("rejects a field name that would hit an inherited setter", () => {
		// `out.__proto__ = x` assigns through the prototype instead of creating an answer key.
		for (const name of ["__proto__", "constructor", "prototype"]) {
			expect(normalizeElicitationRequest(form({ [name]: { type: "string" } }))).toMatchObject({
				ok: false,
			});
		}
	});

	it("rejects options whose values collide", () => {
		// The form keys its options by value, so duplicates break rendering outright.
		expect(
			normalizeElicitationRequest(form({ pick: { type: "string", enum: ["a", "a"] } }))
		).toMatchObject({ ok: false });
		expect(
			normalizeElicitationRequest(
				form({ pick: { type: "array", items: { type: "string", enum: ["a", "a"] } } })
			)
		).toMatchObject({ ok: false });
	});

	it("sanitizes an option label that falls back to its raw value", () => {
		const [field] = fieldsOf(form({ pick: { type: "string", enum: ["ok\u0007bad"] } }));

		expect(field).toMatchObject({ options: [{ value: "ok\u0007bad", label: "ok bad" }] });
	});

	it("strips control characters out of server-authored display text", () => {
		const [field] = fieldsOf(form({ name: { type: "string", title: "Name\n​Admin only" } }));

		expect(field.title).toBe("Name  Admin only");
	});

	it("refuses url elicitation over a scheme that is not http(s)", () => {
		for (const url of ["javascript:alert(1)", "data:text/html,hi", "file:///etc/passwd"]) {
			expect(normalizeElicitationRequest({ mode: "url", message: "Sign in", url })).toMatchObject({
				ok: false,
			});
		}
	});

	it("accepts an https url elicitation", () => {
		const result = normalizeElicitationRequest({
			mode: "url",
			message: "Sign in",
			url: "https://example.com/auth?x=1",
		});

		expect(result).toMatchObject({
			ok: true,
			payload: { mode: "url", url: "https://example.com/auth?x=1" },
		});
	});

	it("rejects an unknown mode rather than guessing", () => {
		expect(normalizeElicitationRequest({ mode: "voice", message: "hi" })).toMatchObject({
			ok: false,
		});
	});

	it("rejects a form with no message, no fields, or too many", () => {
		expect(normalizeElicitationRequest(form({ a: { type: "string" } }))).toMatchObject({
			ok: true,
		});
		expect(
			normalizeElicitationRequest({ requestedSchema: { type: "object", properties: {} } })
		).toMatchObject({ ok: false });
		expect(normalizeElicitationRequest(form({}))).toMatchObject({ ok: false });

		const many = Object.fromEntries(
			Array.from({ length: 33 }, (_, i) => [`f${i}`, { type: "string" }])
		);
		expect(normalizeElicitationRequest(form(many))).toMatchObject({ ok: false });
	});
});

describe("validateElicitationContent", () => {
	const fields = fieldsOf(
		form(
			{
				name: { type: "string", minLength: 2, maxLength: 5 },
				email: { type: "string", format: "email" },
				age: { type: "integer", minimum: 18, maximum: 120 },
				agree: { type: "boolean" },
				plan: { type: "string", enum: ["free", "pro"] },
				tags: { type: "array", items: { type: "string", enum: ["a", "b"] }, maxItems: 1 },
			},
			["name"]
		)
	);

	it("accepts a well-formed answer", () => {
		const result = validateElicitationContent(fields, {
			name: "Ada",
			email: "ada@example.com",
			age: 36,
			agree: true,
			plan: "pro",
			tags: ["a"],
		});

		expect(result).toEqual({
			ok: true,
			content: {
				name: "Ada",
				email: "ada@example.com",
				age: 36,
				agree: true,
				plan: "pro",
				tags: ["a"],
			},
		});
	});

	it("omits fields left blank when they are optional", () => {
		expect(validateElicitationContent(fields, { name: "Ada" })).toEqual({
			ok: true,
			content: { name: "Ada" },
		});
	});

	it("requires the fields the server marked required", () => {
		expect(validateElicitationContent(fields, { age: 20 })).toMatchObject({ ok: false });
	});

	it("rejects a field the server never asked for", () => {
		// Otherwise the endpoint lets anyone inject extra keys into what the server receives.
		expect(validateElicitationContent(fields, { name: "Ada", admin: true })).toMatchObject({
			ok: false,
		});
	});

	it("enforces the constraints the browser also enforces", () => {
		const cases = [
			{ name: "A" },
			{ name: "Abcdef" },
			{ name: "Ada", email: "nope" },
			{ name: "Ada", age: 17 },
			{ name: "Ada", age: 20.5 },
			{ name: "Ada", agree: "yes" },
			{ name: "Ada", plan: "enterprise" },
			{ name: "Ada", tags: ["a", "b"] },
			{ name: "Ada", tags: ["c"] },
			{ name: "Ada", tags: ["a", "a"] },
			{ name: 42 },
		];

		for (const answer of cases) {
			expect(validateElicitationContent(fields, answer), JSON.stringify(answer)).toMatchObject({
				ok: false,
			});
		}
	});

	it("rejects a calendar date that does not exist", () => {
		// Date.parse rolls 2024-02-31 forward into March rather than rejecting it.
		const dated = fieldsOf(form({ when: { type: "string", format: "date" } }, ["when"]));

		expect(validateElicitationContent(dated, { when: "2024-02-31" })).toMatchObject({ ok: false });
		expect(validateElicitationContent(dated, { when: "2024-02-29" })).toMatchObject({ ok: true });
	});

	it("requires a date-time to carry an offset, as RFC 3339 does", () => {
		const stamped = fieldsOf(form({ at: { type: "string", format: "date-time" } }, ["at"]));

		expect(validateElicitationContent(stamped, { at: "2024-03-01T10:00" })).toMatchObject({
			ok: false,
		});
		expect(validateElicitationContent(stamped, { at: "2024-03-01T10:00:00Z" })).toMatchObject({
			ok: true,
		});
		expect(validateElicitationContent(stamped, { at: "2024-03-01T10:00:00+02:00" })).toMatchObject({
			ok: true,
		});
	});

	it("rejects an answer that is not an object", () => {
		expect(validateElicitationContent(fields, "Ada")).toMatchObject({ ok: false });
	});
});
