export function deepestChild(el: HTMLElement) {
	let newEl = el;
	while (newEl.hasChildNodes()) {
		newEl = newEl.lastElementChild as HTMLElement;
	}
	return newEl;
}
