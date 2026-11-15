import type { RequestHandler } from "./$types";
export const GET: RequestHandler = () =>
	new Response(
		`
const status=document.getElementById('status'), messages=document.getElementById('messages'), notice=document.getElementById('error');
const root=location.pathname.replace(/\\/$/,'');let busy=false,stopped=false,last='';
function node(tag,text,cls){const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(cls)el.className=cls;return el;}
function detail(parent,label,value,key){const el=node('details');el.dataset.key=key;el.append(node('summary',label),node('pre',JSON.stringify(value,null,2)));parent.append(el);}
async function refresh(){if(busy||stopped||document.hidden)return;busy=true;try{
 const r=await fetch(root+'/data',{cache:'no-store'});if(!r.ok){messages.replaceChildren();status.hidden=true;last='';if(r.status===401||r.status===403)stopped=true;throw Error(r.status===401?'Sign-in expired. Reload to sign in again.':r.status===403?'You no longer have access to this Slack session.':'Could not refresh. Slack may be unavailable; retry shortly.');}
 const data=await r.json();notice.textContent='';document.getElementById('updated').textContent='Updated '+new Date().toLocaleTimeString()+' · Refreshes every 15 seconds';
 const fingerprint=JSON.stringify(data);if(fingerprint===last)return;last=fingerprint;
 const open=new Set([...document.querySelectorAll('details[open]')].map(e=>e.dataset.key));
 status.hidden=false;status.replaceChildren(node('h2',data.state?.status||data.generation?.status||'Session'));
 if(data.budget){const usd=n=>'$'+((n||0)/1000000).toFixed(2);status.append(node('p',usd(data.budget.spent)+' spent · '+usd(data.budget.total)+' budget'));}
 if(data.generation?.lastHeartbeatAt)status.append(node('p','Last worker heartbeat: '+new Date(data.generation.lastHeartbeatAt).toLocaleString(),'muted'));
 const link=node('a','Open Slack thread');link.href=data.slackUrl;link.rel='noreferrer';status.append(link);
 detail(status,'Run state and compute reservations',{state:data.state,generation:data.generation,budget:data.budget},'state');
 messages.replaceChildren();if(data.truncated)messages.append(node('p','Showing the latest 100 messages.','muted'));
 for(const m of data.messages){const article=node('article');article.append(node('div',m.role+(m.createdAt?' · '+new Date(m.createdAt).toLocaleString():''),'label'));article.append(node('div',m.text,'message'));if(m.files?.length)article.append(node('p','Attachments: '+m.files.map(f=>f.name).join(', '),'muted'));
 for(const [i,e]of m.events.entries())detail(article,[e.type,e.subtype,e.call?.name||e.result?.call?.name].filter(Boolean).join(' · '),e,m.id+':'+i);messages.append(article);}
 for(const el of document.querySelectorAll('details'))if(open.has(el.dataset.key))el.open=true;
}catch(e){notice.textContent=e.message;}finally{busy=false;}}
document.getElementById('refresh').onclick=()=>{stopped=false;refresh();};
document.getElementById('logout').onclick=async()=>{const r=await fetch(root.replace(/[^/]+$/,'logout'),{method:'POST'});if(r.ok){stopped=true;messages.replaceChildren();status.hidden=true;location.reload();}else notice.textContent='Could not sign out. Please retry.';};
refresh();setInterval(refresh,15000);document.addEventListener('visibilitychange',refresh);
`,
		{ headers: { "Content-Type": "application/javascript; charset=utf-8" } }
	);
