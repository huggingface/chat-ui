/**
 * Server↔client clock offset, estimated from the freshest `serverNow` the app
 * has seen — the conversation snapshot on load, and every in-band turnState
 * event at receipt. A waiting turn's countdown renders from its ABSOLUTE
 * deadline as `until - (Date.now() + skew)`, so it is correct on live
 * delivery, on reload, and on a machine with a wrong clock.
 */
let skewMs = $state(0);

export function noteServerNow(serverNow: number | undefined): void {
	if (typeof serverNow !== "number" || !Number.isFinite(serverNow)) return;
	skewMs = serverNow - Date.now();
}

export function serverCorrectedNow(): number {
	return Date.now() + skewMs;
}
