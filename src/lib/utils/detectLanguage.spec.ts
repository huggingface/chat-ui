import { describe, expect, it } from "vitest";
import { detectLanguage } from "./detectLanguage";

describe("detectLanguage", () => {
	it.each([
		["Which open-weight LLMs are at the top of LMArena right now?", "English"],
		[
			"Voici mes ventes mensuelles 2025. Calcule la croissance mois par mois et fais un graphique.",
			"French",
		],
		["¿Cuáles son los mejores modelos abiertos para programar en Python?", "Spanish"],
		["Kannst du mir bitte erklären, wie das Training mit LoRA funktioniert?", "German"],
		["Você pode me ajudar com isso? Não entendo o erro.", "Portuguese"],
		["请解释Transformer是如何工作的", "Chinese"],
		["このモデルの使い方を教えてください", "Japanese"],
		["이 모델을 어떻게 사용하나요?", "Korean"],
		["Как запустить эту модель локально?", "Russian"],
		["كيف أستخدم هذا النموذج؟", "Arabic"],
	])("%s -> %s", (text, language) => {
		expect(detectLanguage(text)).toBe(language);
	});

	it("falls back to English when nothing stands out", () => {
		expect(detectLanguage("")).toBe("English");
		expect(detectLanguage("gpt-oss-120b vs GLM-5.3?")).toBe("English");
	});
});
