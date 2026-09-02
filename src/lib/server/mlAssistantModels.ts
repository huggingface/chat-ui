import JSON5 from "json5";
import { z } from "zod";
import { config } from "./config";
import { logger } from "./logger";
import { ML_ASSISTANT_MODE } from "$lib/utils/mlAssistantFlag";

/**
 * The fixed set of models ML Intern conversations may run on, from
 * `ML_ASSISTANT_MODELS`. Separate from the catalog on purpose: the mode
 * drives 1M-token tool loops, and the same model behaves very differently
 * across inference providers at that size (see scripts/probe-model.ts), so
 * each entry pins the provider the model was verified on. The router alias
 * is excluded by construction — it can't be listed here.
 *
 * The first entry is the default. `parameters` merge over the catalog entry's
 * for mode conversations only.
 */
const entrySchema = z.object({
	id: z.string().trim().min(1),
	provider: z.string().trim().min(1).optional(),
	parameters: z.record(z.unknown()).optional(),
});

export type MlAssistantModelEntry = z.infer<typeof entrySchema>;

/**
 * Parse the env value. Entries whose id is not in `knownIds` are dropped with
 * an error log rather than failing startup: a model leaving the router should
 * not take the whole app down, and the mode still works with what remains.
 */
export function parseMlAssistantModels(
	raw: string | undefined,
	knownIds?: Iterable<string>
): MlAssistantModelEntry[] {
	// Backtick-wrapped like MODELS, so the same .env convention works here.
	const trimmed = (raw ?? "").trim();
	const unquoted =
		trimmed.startsWith("`") && trimmed.endsWith("`") ? trimmed.slice(1, -1) : trimmed;
	if (!unquoted.trim()) return [];
	let entries: MlAssistantModelEntry[];
	try {
		entries = z.array(entrySchema).parse(JSON5.parse(unquoted));
	} catch (error) {
		logger.error(error, "[mlAssistant] Failed to parse ML_ASSISTANT_MODELS");
		return [];
	}
	const known = knownIds ? new Set(knownIds) : undefined;
	const seen = new Set<string>();
	const kept: MlAssistantModelEntry[] = [];
	for (const entry of entries) {
		if (seen.has(entry.id)) continue;
		if (known && !known.has(entry.id)) {
			logger.error(
				{ id: entry.id },
				"[mlAssistant] ML_ASSISTANT_MODELS entry is not a known model"
			);
			continue;
		}
		seen.add(entry.id);
		kept.push(entry);
	}
	return kept;
}

let cachedRaw: string | undefined;
let cachedEntries: MlAssistantModelEntry[] = [];

/**
 * The configured entries, validated against the loaded catalog. Re-parsed
 * only when the env value changes (the config manager can update it live).
 */
export function mlAssistantModelEntries(): MlAssistantModelEntry[] {
	if (!ML_ASSISTANT_MODE) return [];
	const raw = (Reflect.get(config, "ML_ASSISTANT_MODELS") as string | undefined) ?? "";
	if (raw !== cachedRaw) {
		cachedRaw = raw;
		cachedEntries = parseMlAssistantModels(raw, knownModelIds());
	}
	return cachedEntries;
}

let knownIdsResolver: () => Iterable<string> | undefined = () => undefined;

/**
 * Installed by the models module once the catalog is loaded, so this module
 * never imports it (the catalog is what the entries are validated against,
 * and importing it here would tie parsing to catalog startup).
 */
export function setMlAssistantKnownModelIds(resolver: () => Iterable<string> | undefined): void {
	knownIdsResolver = resolver;
	cachedRaw = undefined;
}

function knownModelIds(): Iterable<string> | undefined {
	return knownIdsResolver();
}

export function mlAssistantModelIds(): string[] {
	return mlAssistantModelEntries().map((e) => e.id);
}

export function mlAssistantModelEntry(modelId: string): MlAssistantModelEntry | undefined {
	return mlAssistantModelEntries().find((e) => e.id === modelId);
}

/**
 * The model a new mode conversation runs on: the requested one when it is in
 * the set, else the default. `undefined` when the set is empty, which callers
 * treat as "the mode has no models configured".
 */
export function resolveMlAssistantModel(requested: string | undefined): string | undefined {
	const entries = mlAssistantModelEntries();
	if (entries.length === 0) return undefined;
	return entries.find((e) => e.id === requested)?.id ?? entries[0].id;
}

/**
 * Provider for a mode conversation's request. The pinned provider always wins
 * over the user's per-model preference: "auto" and the policies can route to
 * a provider the model was never verified on. A model outside the set keeps
 * the user's preference, so a conversation on a since-removed entry still
 * runs rather than silently changing behaviour.
 */
export function mlAssistantProviderFor(
	modelId: string,
	userPreference: string | undefined
): string | undefined {
	return mlAssistantModelEntry(modelId)?.provider ?? userPreference;
}
