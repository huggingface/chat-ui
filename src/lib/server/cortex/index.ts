import { ExpansionModule } from "./expansion";
import { ContractionModule } from "./contraction";

/**
 * Synchronization wrapper that takes outputs from both modules, applies a resolution
 * algorithm to handle conflicting constraints, and synthesizes the context.
 */
export class CortexIntegrationEngine {
	private expansion: ExpansionModule;
	private contraction: ContractionModule;

	constructor() {
		this.expansion = new ExpansionModule();
		this.contraction = new ContractionModule();
	}

	public async processQuery(rawInput: string, sessionState: Record<string, unknown>) {
		const [expandedData, contractedData] = await Promise.all([
			this.expansion.expand(rawInput, sessionState),
			this.contraction.contract(rawInput),
		]);

		// Resolution algorithm handling conflicting constraints
		const synthesizedPrompt = this.resolveConflicts(expandedData, contractedData);

		return {
			synthesizedPrompt,
			metadata: expandedData.systemicContext,
			directives: contractedData.coreDirectives,
		};
	}

	private resolveConflicts(
		expanded: { systemicContext: Record<string, unknown> },
		contracted: { coreDirectives: string[]; strippedQuery: string }
	) {
		// Cortex logic mapping constraint overlaps
		return `[DIRECTIVES: ${contracted.coreDirectives.join(", ")}]\n\n[CONTEXT_META: ${JSON.stringify(expanded.systemicContext)}]\n\n${contracted.strippedQuery}`;
	}
}
