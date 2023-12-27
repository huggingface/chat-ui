export const timeout = <T>(prom: Promise<T>, time: number): Promise<T> => {
	let timer: NodeJS.Timeout;
	return Promise.race([prom, new Promise<T>((_r, rej) => (timer = setTimeout(rej, time)))]).finally(
		() => clearTimeout(timer)
	);
};
