import { config } from "$lib/server/config";

/**
 * Voice mode: hands-free spoken conversations. The pipeline is
 * mic → VAD (client) → /api/transcribe (Whisper) → LLM pinned to a specific
 * inference provider → /api/tts → audio playback.
 *
 * The conversational model is intentionally restricted: voice mode is only
 * offered for VOICE_CHAT_MODEL served through VOICE_CHAT_PROVIDER (by default
 * Gemma 4 31B on Cerebras, which is fast enough for real-time speech).
 */

export const DEFAULT_VOICE_CHAT_MODEL = "google/gemma-4-31B-it";
export const DEFAULT_VOICE_CHAT_PROVIDER = "cerebras";

export function getVoiceChatModelId(): string {
	return (config.VOICE_CHAT_MODEL || DEFAULT_VOICE_CHAT_MODEL).trim();
}

export function getVoiceChatProvider(): string {
	return (config.VOICE_CHAT_PROVIDER || DEFAULT_VOICE_CHAT_PROVIDER).trim().toLowerCase();
}

/** Voice mode needs both speech-to-text and text-to-speech configured. */
export function isVoiceChatEnabled(): boolean {
	return Boolean(config.get("TRANSCRIPTION_MODEL")) && Boolean(config.get("TTS_MODEL"));
}

const VOICE_MODE_PROMPT = `You are having a spoken voice conversation: the user's words are transcribed from speech and your reply is read aloud by a text-to-speech engine.
- Answer in plain conversational prose only. Never use markdown, bullet points, numbered lists, tables, headings, code blocks, URLs, or emoji.
- Keep replies short and natural, like speech: one to three sentences unless the user explicitly asks for depth.
- Spell things the way they should be spoken (say "about three point five percent", not "~3.5%").
- Reply in the language the user is speaking.
- The transcription may contain small errors; infer the intended meaning instead of asking the user to repeat, unless the request is truly ambiguous.`;

export function injectVoiceModePrompt(preprompt?: string): string {
	const base = preprompt?.trim();
	return base ? `${base}\n\n${VOICE_MODE_PROMPT}` : VOICE_MODE_PROMPT;
}
