import { describe, test, expect } from "vitest";
import { compileTemplate } from "./template";

// NOTE: `compileTemplate` currently has no callers in `src/` and its `@huggingface/jinja`
// dependency is not declared in package.json (it resolves transitively). If it stays, the
// dependency should be declared; if it is genuinely dead, this file and `template.ts`
// should both go. These tests pin the behaviour that actually exists in the meantime.
//
// `compileTemplate` picks an engine by capability, not by configuration:
//   1. try to parse as Jinja; if that succeeds, render with Jinja
//   2. if Jinja parsing OR rendering throws, render with Handlebars
// The `templateEngine` field on the model argument is accepted by the type signature but
// never read — see the test at the bottom.

const messages = [
	{ from: "user", content: "Hello there" },
	{ from: "assistant", content: "Hi, how can I help?" },
];

const expected =
	"<s>Source: system\n\nSystem Message<step>Source: user\n\nHello there<step>Source: assistant\n\nHi, how can I help?<step>Source: assistant\nDestination: user\n\n";

// `{% if %}` / `{% for %}` are Jinja-only. Handlebars (compiled here with `strict` and
// `knownHelpersOnly`) cannot render this, so the expected output proves the Jinja path ran.
const jinjaOnlyTemplate = `<s>{% if preprompt %}Source: system\n\n{{ preprompt }}<step>{% endif %}{% for message in messages %}{% if message.from == 'user' %}Source: user\n\n{{ message.content }}<step>{% elif message.from == 'assistant' %}Source: assistant\n\n{{ message.content }}<step>{% endif %}{% endfor %}Source: assistant\nDestination: user\n\n`;

// `{{#if}}` / `{{#each}}` are Handlebars block syntax, which Jinja cannot parse. Reaching
// the expected output therefore proves the Handlebars fallback ran.
const handlebarsOnlyTemplate = `<s>{{#if preprompt}}Source: system\n\n{{preprompt}}<step>{{/if}}{{#each messages}}{{#ifUser}}Source: user\n\n{{content}}<step>{{/ifUser}}{{#ifAssistant}}Source: assistant\n\n{{content}}<step>{{/ifAssistant}}{{/each}}Source: assistant\nDestination: user\n\n`;

describe("compileTemplate", () => {
	test("renders Jinja syntax with the Jinja engine", () => {
		const render = compileTemplate(jinjaOnlyTemplate, { preprompt: "System Message" });

		// Trailing-whitespace handling differs between the two engines.
		expect(render({ messages }).trim()).toBe(expected.trim());
	});

	test("falls back to Handlebars when the template is not valid Jinja", () => {
		const render = compileTemplate(handlebarsOnlyTemplate, { preprompt: "System Message" });

		expect(render({ messages })).toBe(expected);
	});

	test("merges model fields with render-time inputs", () => {
		const render = compileTemplate("Test: {{preprompt}} and {{foo}}", { preprompt: "Hello" });

		expect(render({ foo: "World" })).toBe("Test: Hello and World");
	});

	test("ignores `templateEngine` — the engine is chosen by what parses, not by config", () => {
		// Both calls must produce identical output despite opposite `templateEngine` values.
		// If this ever starts failing, `templateEngine` has gained real behaviour and the
		// comment at the top of this file is stale.
		const asJinja = compileTemplate(handlebarsOnlyTemplate, {
			preprompt: "System Message",
			templateEngine: "jinja",
		});
		const asHandlebars = compileTemplate(handlebarsOnlyTemplate, {
			preprompt: "System Message",
			templateEngine: "handlebars",
		});

		expect(asJinja({ messages })).toBe(asHandlebars({ messages }));
	});
});
