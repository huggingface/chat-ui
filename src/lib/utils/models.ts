import { get } from "svelte/store";
import { page } from "$app/stores";
import type { Model } from "$lib/types/Model";

export const findConvModelName = (conversations: any) =>
	conversations.find((conv: any) => conv.id === get(page).params.id)?.title;

export const findCurrentModel = (models: Model[], name?: string) =>
	models.find((m) => m.name === name) ?? models[0];
