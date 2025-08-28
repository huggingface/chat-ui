import { json } from "@sveltejs/kit";
import { config } from "$lib/server/config";

export async function GET() {
    const base = (config.OPENAI_BASE_URL || config.OPENAI_MODEL_LIST_URL || "").replace(/\/$/, "");
    if (!base) return json({ base, error: "no_base" });
    try {
        const res = await fetch(`${base}/models`);
        const text = await res.text();
        let length: number | null = null;
        try {
            const parsed = JSON.parse(text);
            length = Array.isArray(parsed?.data) ? parsed.data.length : null;
        } catch {}
        return json({ base, status: res.status, ok: res.ok, length, sample: text.slice(0, 1000) });
    } catch (e) {
        return json({ base, error: String(e) });
    }
}

