import { env } from "$env/dynamic/public";

export const isHuggingChat = env.PUBLIC_APP_ASSETS === "huggingchat";
