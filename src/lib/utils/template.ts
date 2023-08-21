import type { Message } from "$lib/types/Message";
import type { LegacyParamatersTemplateInput } from "$lib/types/Template";
import Handlebars from "handlebars";

Handlebars.registerHelper("ifUser", function (this: Pick<Message, "from" | "content">, options) {
	if (this.from == "user") return options.fn(this);
});

Handlebars.registerHelper(
	"ifAssistant",
	function (this: Pick<Message, "from" | "content">, options) {
		if (this.from == "assistant") return options.fn(this);
	}
);

export function compileTemplate<T>(input: string, model: LegacyParamatersTemplateInput) {
	const template = Handlebars.compile<T & LegacyParamatersTemplateInput>(input, {
		knownHelpers: { ifUser: true, ifAssistant: true },
		knownHelpersOnly: true,
		noEscape: true,
		strict: true,
		preventIndent: true,
	});

	return function render(inputs: T, options?: RuntimeOptions) {
		return template({ ...model, ...inputs }, options);
	};
}
