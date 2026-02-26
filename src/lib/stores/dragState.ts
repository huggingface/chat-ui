import { writable } from "svelte/store";
import type { ConvSidebar } from "$lib/types/ConvSidebar";

export interface DragState {
	isDragging: boolean;
	draggedConv: ConvSidebar | null;
	sourceGroupId: string | null;
	ghostPosition: { x: number; y: number };
	dropTarget: {
		type: "conversation" | "group";
		id: string;
	} | null;
}

const initial: DragState = {
	isDragging: false,
	draggedConv: null,
	sourceGroupId: null,
	ghostPosition: { x: 0, y: 0 },
	dropTarget: null,
};

export const dragState = writable<DragState>(initial);

export function startDrag(conv: ConvSidebar, x: number, y: number, sourceGroupId?: string) {
	dragState.set({
		isDragging: true,
		draggedConv: conv,
		sourceGroupId: sourceGroupId ?? null,
		ghostPosition: { x, y },
		dropTarget: null,
	});
}

export function updateDragPosition(x: number, y: number) {
	dragState.update((s) => ({ ...s, ghostPosition: { x, y } }));
}

export function setDropTarget(target: DragState["dropTarget"]) {
	dragState.update((s) => ({ ...s, dropTarget: target }));
}

export function endDrag() {
	dragState.set(initial);
}
