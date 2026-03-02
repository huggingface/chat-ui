declare module "*.ttf" {
	const value: ArrayBuffer;
	export default value;
}

declare module "web-haptics/svelte" {
	export function createWebHaptics(options?: { debug?: boolean; showSwitch?: boolean }): {
		trigger: (
			input?:
				| string
				| number
				| number[]
				| { duration: number; intensity?: number; delay?: number }[],
			options?: { intensity?: number }
		) => Promise<void>;
		cancel: () => void;
		destroy: () => void;
		setDebug: (debug: boolean) => void;
		isSupported: boolean;
	};
}

// Legacy helpers removed: web search support is deprecated, so we intentionally
// avoid leaking those shapes into the global ambient types.
