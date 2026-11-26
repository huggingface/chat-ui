/** the monthly credits PRO includes, the amount the estimate is quoted for */
export const CREDIT_ESTIMATE_USD = 2;

/** policies that let the HF router pick the provider, so no single price applies */
const ROUTER_POLICIES = new Set(["auto", "fastest", "preferred"]);

/** a chat turn resends its history, so input outweighs output about 5 to 1 */
const INPUT_SHARE = 5 / 6;

export interface ProviderPricing {
	provider: string;
	status?: string;
	/** USD per 1M tokens, as the HF router lists it */
	pricing?: { input?: unknown; output?: unknown };
}

/** USD per 1M tokens for a typical chat mix, undefined when the provider has no usable price */
function blendedPrice(provider: ProviderPricing): number | undefined {
	if (provider.status !== undefined && provider.status !== "live") return undefined;
	const { input, output } = provider.pricing ?? {};
	if (typeof input !== "number" || typeof output !== "number") return undefined;
	if (!(input >= 0) || !(output >= 0)) return undefined;
	const price = INPUT_SHARE * input + (1 - INPUT_SHARE) * output;
	return price > 0 ? price : undefined;
}

function median(values: number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** priced at the user pick, else the model default, else the median when the router picks */
export function estimateTokens(
	providers: ProviderPricing[] | undefined,
	choice: { providerOverride?: string; defaultProvider?: string },
	usd: number = CREDIT_ESTIMATE_USD
): number | undefined {
	const prices = new Map<string, number>();
	for (const provider of providers ?? []) {
		const price = blendedPrice(provider);
		if (price !== undefined) prices.set(provider.provider, price);
	}
	if (prices.size === 0) return undefined;

	const picked = choice.providerOverride || undefined;
	let price: number;
	if (picked === "cheapest") price = Math.min(...prices.values());
	else if (picked && ROUTER_POLICIES.has(picked)) price = median([...prices.values()]);
	else
		price =
			(picked && prices.get(picked)) ||
			(choice.defaultProvider && prices.get(choice.defaultProvider)) ||
			median([...prices.values()]);

	return (usd / price) * 1_000_000;
}

/** rounds down to two significant digits so the estimate never overpromises */
export function formatTokenCount(tokens: number): string {
	const units: Array<[number, string]> = [
		[1e9, "B"],
		[1e6, "M"],
		[1e3, "k"],
	];
	for (const [size, suffix] of units) {
		if (tokens >= size) return `${floorToTwoDigits(tokens / size)}${suffix}`;
	}
	return String(floorToTwoDigits(tokens));
}

function floorToTwoDigits(value: number): number {
	if (value < 10) return Math.floor(value * 10) / 10;
	const step = 10 ** (Math.floor(Math.log10(value)) - 1);
	return Math.floor(value / step) * step;
}
