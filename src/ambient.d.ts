declare module "*.ttf" {
	const value: ArrayBuffer;
	export default value;
}

// Legacy helpers removed: web search support is deprecated, so we intentionally
// avoid leaking those shapes into the global ambient types.

/**
 * Build flag for ML Assistant mode, inlined by Vite's `define` (see vite.config.ts).
 * Set `ML_ASSISTANT_MODE=true` in the build environment to compile the feature in;
 * with it off the constant folds to `false` and every gate on it is dead code.
 */
declare const __ML_ASSISTANT_MODE__: boolean;
