/// A not-that-great throttling function
export function throttle<T extends unknown[]>(
	callback: (...rest: T) => unknown,
	limit: number
): (...rest: T) => void {
	let last: number;
	/// setTimeout can return different types on browser or node
	let deferTimer: ReturnType<typeof setTimeout>;

	return function (...rest) {
		const now = Date.now();
		if (last && now < last + limit) {
			clearTimeout(deferTimer);
			deferTimer = setTimeout(function () {
				last = now;
				callback(...rest);
			}, limit);
		} else {
			last = now;
			callback(...rest);
		}
	};
}
