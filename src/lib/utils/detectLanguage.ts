/**
 * Best-effort guess of the language a message is written in, as an English name ("French").
 * Used to tell a small model which language to answer in: an agent often reasons in English
 * even when the user writes in another language, and small models follow the reasoning.
 * Script ranges decide non-Latin languages; common short words decide Latin ones. Falls back
 * to English when nothing stands out.
 */

const SCRIPTS: Array<[RegExp, string]> = [
	[/[぀-ヿ]/, "Japanese"],
	[/[가-힯]/, "Korean"],
	[/[一-鿿]/, "Chinese"],
	[/[؀-ۿ]/, "Arabic"],
	[/[֐-׿]/, "Hebrew"],
	[/[ऀ-ॿ]/, "Hindi"],
	[/[฀-๿]/, "Thai"],
	[/[Ͱ-Ͽ]/, "Greek"],
	[/[Ѐ-ӿ]/, "Russian"],
];

const WORDS: Record<string, string[]> = {
	English:
		"the and is are of to in for with what how can you my this that it on please why which".split(
			" "
		),
	French:
		"le la les des est et une un du pour avec que qui dans pas je vous mon ma mes ce cette sur au aux quel quelle comment pourquoi voici fais peux".split(
			" "
		),
	Spanish:
		"el la los las es y una un del para con que por en no mi cómo qué porque puedes hola esto este esta".split(
			" "
		),
	German:
		"der die das und ist ein eine nicht mit für ich du sie wie was auf zu mein bitte kannst warum den dem".split(
			" "
		),
	Portuguese:
		"o a os as é e um uma do da dos das para com que não por em meu minha como você isso olá".split(
			" "
		),
	Italian:
		"il lo la gli le è e un una del della per con che non di mi come perché questo ciao puoi".split(
			" "
		),
	Dutch: "de het een en is van voor met niet ik je wat hoe dat op mijn kun waarom".split(" "),
};

const ACCENTS: Array<[RegExp, string]> = [
	[/[ñ¿¡]/, "Spanish"],
	[/[ß]|[äöü]/, "German"],
	[/[ãõ]/, "Portuguese"],
	[/[çàèêëîïôûœ]/, "French"],
];

export function detectLanguage(text: string): string {
	const sample = text.slice(0, 2000);
	for (const [pattern, language] of SCRIPTS) {
		if (pattern.test(sample)) {
			if (language === "Russian" && /[іїєґ]/i.test(sample)) return "Ukrainian";
			return language;
		}
	}

	const tokens = sample.toLowerCase().match(/[\p{L}']+/gu) ?? [];
	const scores = new Map<string, number>();
	for (const [language, words] of Object.entries(WORDS)) {
		const set = new Set(words);
		scores.set(language, tokens.filter((token) => set.has(token)).length);
	}
	for (const [pattern, language] of ACCENTS) {
		if (pattern.test(sample)) scores.set(language, (scores.get(language) ?? 0) + 1.5);
	}

	let best = "English";
	let bestScore = 0;
	for (const [language, score] of scores) {
		if (score > bestScore) {
			best = language;
			bestScore = score;
		}
	}
	return best;
}
