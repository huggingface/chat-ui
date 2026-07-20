import { describe, test, expect } from "vitest";
import { compileTemplate } from "./template";

const messages = [
	{ from: "user", content: "Hello there" },
	{ from: "assistant", content: "Hi, how can I help?" },
];

const expected =
	"<s>Source: system\n\nSystem Message<step>Source: user\n\nHello there<step>Source: assistant\n\nHi, how can I help?<step>Source: assistant\nDestination: user\n\n";

const jinjaOnlyTemplate = `<s>{% if preprompt %}Source: system\n\n{{ preprompt }}<step>{% endif %}{% for message in messages %}{% if message.from == 'user' %}Source: user\n\n{{ message.content }}<step>{% elif message.from == 'assistant' %}Source: assistant\n\n{{ message.content }}<step>{% endif %}{% endfor %}Source: assistant\nDestination: user\n\n`;

const handlebarsOnlyTemplate = `<s>{{#if preprompt}}Source: system\n\n{{preprompt}}<step>{{/if}}{{#each messages}}{{#ifUser}}Source: user\n\n{{content}}<step>{{/ifUser}}{{#ifAssistant}}Source: assistant\n\n{{content}}<step>{{/ifAssistant}}{{/each}}Source: assistant\nDestination: user\n\n`;

describe("compileTemplate", () => {
	test("renders Jinja syntax with the Jinja engine", () => {
		const render = compileTemplate(jinjaOnlyTemplate, { preprompt: "System Message" });

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
