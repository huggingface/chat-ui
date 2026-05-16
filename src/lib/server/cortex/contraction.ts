export class ContractionModule {
	/**
	 * Strips conversational noise, condenses core intent,
	 * and isolates key programming directives.
	 */
	public async contract(
		input: string
	): Promise<{ coreDirectives: string[]; strippedQuery: string }> {
		const directives = this.extractDirectives(input);
		const noiseReduced = input
			.replace(/(please|can you|could you|I would like to|just)/gi, "")
			.trim();

		return {
			coreDirectives: directives,
			strippedQuery: noiseReduced,
		};
	}

	private extractDirectives(input: string): string[] {
		// Logic engine isolating code constraints or actions
		const keywords = ["implement", "fix", "refactor", "create", "delete", "write"];
		return keywords.filter((k) => input.toLowerCase().includes(k));
	}
}
