import { env as envPublic } from "$env/dynamic/public";

export const isHuggingChat = envPublic.PUBLIC_APP_ASSETS === "huggingchat";
