/**
 * ML Assistant mode is a preset that loads a fixed set of tools and prompts for
 * machine-learning work, surfaced as a header strip on the composer.
 *
 * The flag is a build-time constant (`define` in vite.config.ts), not a runtime
 * config key: a build either ships the feature or has no way to turn it on, so
 * the preset can't be reached by flipping an env var on a deployed instance.
 * (The components still land in the bundle — Svelte's compiled templates aren't
 * side-effect-free, so the branch folds but the modules don't tree-shake.)
 *
 * Enable with `ML_ASSISTANT_MODE=true` in the build environment or `.env.local`.
 */
export const ML_ASSISTANT_MODE: boolean = __ML_ASSISTANT_MODE__;
