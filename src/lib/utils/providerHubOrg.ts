import { PROVIDERS_HUB_ORGS } from "@huggingface/inference";

/** Hub orgs of the providers the HF router reaches through OpenRouter, the ones the Hub shows */
const OPENROUTER_PROVIDERS_HUB_ORGS: Record<string, string> = {
	openrouter: "OpenRouter",
	coreweave: "coreweave",
	digitalocean: "DigitalOceanHF",
	liquid: "LiquidAI",
	mistral: "mistralai",
	moonshotai: "moonshotai",
	nebius: "nebius",
	parasail: "parasail-ai",
	primeintellect: "PrimeIntellect",
	reka: "RekaAI",
	tencent: "tencent",
};

/** The Hub org of an inference provider, for its avatar and link */
export function providerHubOrg(provider: string | undefined): string | undefined {
	if (!provider) return undefined;
	return (
		(PROVIDERS_HUB_ORGS as Record<string, string>)[provider] ??
		OPENROUTER_PROVIDERS_HUB_ORGS[provider]
	);
}
