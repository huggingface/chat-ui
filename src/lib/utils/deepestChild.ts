export function deepestChild(el: HTMLElement): HTMLElement {
	let newEl = el;
	if (newEl.lastElementChild && newEl.lastElementChild.nodeType !== Node.TEXT_NODE) {
		return deepestChild(newEl.lastElementChild as HTMLElement);
	}
	return newEl;
}
