import type { MlBudget } from "$lib/types/Conversation";

export const MICRO_USD_PER_USD = 1_000_000;

/** Sum of open reservation ceilings — money held but not yet settled. */
export function reservedMicroUsd(budget: Pick<MlBudget, "reservations">): number {
	return budget.reservations.reduce((sum, r) => sum + r.ceilingMicroUsd, 0);
}

/** What a new reservation may still claim. Can go negative if the total was lowered under existing holds. */
export function remainingMicroUsd(budget: MlBudget): number {
	return budget.totalMicroUsd - budget.spentMicroUsd - reservedMicroUsd(budget);
}

/** "$1.50" / "$0.03" — always two decimals; sub-cent amounts round up so a hold never displays as free. */
export function formatMicroUsd(microUsd: number): string {
	const sign = microUsd < 0 ? "-" : "";
	const cents = Math.ceil(Math.abs(microUsd) / 10_000);
	return `${sign}$${(cents / 100).toFixed(2)}`;
}

/**
 * The narrowest form of a budget, for the collapsed strip: whole dollars,
 * rounded UP. Ceiling rather than floor so a run with 88 cents left reads as
 * "$1" rather than "$0" — at this width the figure answers "is there budget",
 * and the exact number is a hover and an edit away.
 */
export function formatMicroUsdCompact(microUsd: number): string {
	const sign = microUsd < 0 ? "-" : "";
	return `${sign}$${Math.ceil(Math.abs(microUsd) / MICRO_USD_PER_USD)}`;
}

export function usdToMicroUsd(usd: number): number {
	return Math.round(usd * MICRO_USD_PER_USD);
}
