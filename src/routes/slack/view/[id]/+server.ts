import { error } from "@sveltejs/kit";
import { base } from "$app/paths";
import type { RequestHandler } from "./$types";
import { identity, viewerConfig } from "$lib/server/slack/viewer/auth";
export const GET: RequestHandler = async (event) => {
	if (!viewerConfig()) error(503, "Slack viewer is not configured.");
	const id = event.params.id;
	if (!/^[a-f0-9]{24}$/.test(id)) error(404, "Session not found.");
	const signedIn = !!identity(event);
	// No session data is embedded here: the data endpoint authorizes every refresh.
	return new Response(
		`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>ML Intern · Session viewer</title><style>
 :root{color-scheme:light dark;font-family:system-ui,sans-serif;background:light-dark(#f7f7f8,#121316);color:light-dark(#24262c,#eceef4)}body{max-width:1050px;margin:0 auto;padding:32px 24px}header{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}h1{font-size:26px;margin:8px 0}p{line-height:1.6}.muted{color:light-dark(#626775,#a2a8b5);font-size:14px}button,.button{font:inherit;border:1px solid #8886;border-radius:8px;padding:9px 14px;background:light-dark(white,#22252c);color:inherit;text-decoration:none;cursor:pointer}nav{display:flex;gap:8px;align-items:center}.panel,article{background:light-dark(white,#1b1d23);border:1px solid #8883;border-radius:12px;margin-top:18px;padding:20px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.6 ui-monospace,monospace}.message{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.65}summary{cursor:pointer;padding:10px 0}details{border-top:1px solid #8883;margin-top:12px}#error{color:light-dark(#a21d26,#ff969d)}a{color:light-dark(#245fb7,#9dc3ff)}.label{text-transform:uppercase;letter-spacing:.08em;font-size:12px;font-weight:700}h2{font-size:18px;margin:0 0 12px}
 </style></head><body><header><div><div class="label">ML Intern / Slack</div><h1>Session viewer</h1><div class="muted">Read-only · Answers, budgets and controls remain in Slack</div></div><nav>${signedIn ? '<button id="refresh">Refresh</button><button id="logout">Sign out</button>' : `<a class="button" href="${base}/slack/view/login?session=${id}">Sign in with Slack</a>`}</nav></header>
 ${signedIn ? `<p class="muted" id="updated">Loading session…</p><p id="error" role="alert"></p><section id="status" class="panel" hidden></section><main id="messages"></main><script src="${base}/slack/view/viewer.js" defer></script>` : '<section class="panel"><h2>Inspect a Slack session</h2><p>Sign in to view the conversation, tool calls, errors and job activity. Access requires membership in the original channel. Direct messages are visible only to the session owner.</p></section>'}</body></html>`,
		{ headers: { "Content-Type": "text/html; charset=utf-8" } }
	);
};
