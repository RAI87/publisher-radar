import express from "express";
import { readFileSync, writeFileSync } from "node:fs";
import { storage } from "./storage.js";
import { parseCookies } from "./auth.js";
import { fetchSnapshot, fetchRecentReviews, scoreForecast, draftReply, parseAppId } from "./steam.js";
import { diffSnapshots } from "./alerting.js";
import { pixCode, pixAmount, pixKey } from "./pix.js";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { sendDiscord } from "./discord.js";

const app = express();
app.use("/logo.png", (_req: any, res: any) => {
  res.sendFile(join(dirname(fileURLToPath(import.meta.url)), "..", "public", "logo.png"));
});
app.get("/favicon.ico", (_req: any, res: any) => {
  res.sendFile(join(dirname(fileURLToPath(import.meta.url)), "..", "public", "logo.png"));
});

function stripeConf(): { key: string; wh: string; links: Record<string, string> } {
  return {
    key: process.env.STRIPE_SECRET_KEY || "",
    wh: process.env.STRIPE_WEBHOOK_SECRET || "",
    links: {
      "starter/monthly": process.env.STRIPE_LINK_STARTER || "",
      "pro/monthly": process.env.STRIPE_LINK_PRO || "",
      "pro/annual": process.env.STRIPE_LINK_ANNUAL || ""
    }
  };
}

app.post("/api/billing/stripe", express.raw({ type: "application/json" }), async (req: any, res: any) => {
  try {
    const conf = stripeConf();
    if (!conf.key || !conf.wh) return res.status(500).json({ error: "stripe não configurado" });
    const { default: Stripe } = await import("stripe");
    const stripe = new Stripe(conf.key);
    const sig = String(req.headers["stripe-signature"] || "");
    const event = stripe.webhooks.constructEvent(req.body, sig, conf.wh);
    if (event.type === "checkout.session.completed") {
      const s: any = event.data.object;
      const ref = String(s.client_reference_id || "");
      const [uid, plan, period] = ref.split(":");
      if (uid && (plan === "starter" || plan === "pro")) {
        storage.setPlan(storage.userEmail(uid), plan, period === "annual" ? 12 : 1);
      }
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "webhook inválido" });
  }
});

app.use(express.json());
app.use((_req: any, res: any, next: any) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});

const attempts = new Map<string, { n: number; until: number }>();
function throttled(ip: string): boolean {
  const now = Date.now();
  const a = attempts.get(ip) ?? { n: 0, until: 0 };
  if (now < a.until) return true;
  a.n += 1;
  if (a.n > 20) {
    a.until = now + 5 * 60 * 1000;
    a.n = 0;
  }
  attempts.set(ip, a);
  return false;
}

const COOKIE = "pr_session";
function uidOf(req: any): string | null {
  const token = parseCookies(req.headers?.cookie)[COOKIE];
  if (!token) return null;
  const me = storage.me(token);
  return me ? me.id : null;
}
function setSession(res: any, token: string): void {
  res.setHeader("Set-Cookie", `${COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000`);
}
function clearSession(res: any): void {
  res.setHeader("Set-Cookie", `${COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
}
const U = (req: any): string => uidOf(req)!;

const collecting = new Set<string>();
function collectSoon(uid: string, appIds: string[]): void {
  for (const appId of appIds) {
    if (storage.lastSnapshot(uid, appId)) continue;
    const key = uid + ":" + appId;
    if (collecting.has(key)) continue;
    collecting.add(key);
    fetchSnapshot(appId)
      .then((s) => storage.pushSnapshot(uid, s))
      .catch(() => {})
      .finally(() => collecting.delete(key));
  }
}

app.get("/login", (req: any, res: any) => {
  res.send(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Entrar — Publisher Radar 87</title><style>${css}</style>${pxHead}<style>
  .loginwrap{max-width:460px;margin:7vh auto;padding:0 20px;position:relative;z-index:2;transition:opacity .35s ease,transform .35s ease}
  .loginwrap.out{opacity:0;transform:translateY(14px) scale(.99)}
  .cab{font-size:15px;margin:0 0 6px}
  .coin{font-family:'Press Start 2P',monospace;font-size:8px;color:var(--amber);letter-spacing:2px;animation:blink 1.2s steps(2) infinite}
  .field{margin:10px 0}
  .field label{display:block;font-size:10px;letter-spacing:1.5px;color:var(--mut);margin-bottom:6px;font-family:'Press Start 2P',monospace;font-size:7px}
  .field input{width:100%}
  .shake{animation:shake .3s}
  @keyframes shake{25%{transform:translateX(-6px)}50%{transform:translateX(6px)}75%{transform:translateX(-3px)}}
  </style></head><body>${pxBody}<div class="loginwrap rise" id="lw">
  <div style="text-align:center;margin-bottom:18px"><img src="/logo.png" alt="Publisher Radar 87" style="width:120px;image-rendering:pixelated;border:3px solid #2a3a55;box-shadow:5px 5px 0 #000"/></div>
  <div class="px-title" style="font-size:17px">PUBLISHER RADAR 87<span class="cursor"></span></div>
  <div class="coin" style="margin-top:10px">— INSERT COIN · 1 PLAYER —</div>
  <div class="card" style="border:3px solid #2a3a55;box-shadow:5px 5px 0 #000;margin-top:18px"><p class="cab"><b>Acesso ao painel</b></p><p style="color:#8f98a0;font-size:13px;margin:0 0 6px">Conta piloto com 7 dias grátis e 3 jogos demo. Sem cartão.</p>
  <div class="field"><label>EMAIL</label><input id="email" type="email" placeholder="publisher@studio.com" autocomplete="email"/></div>
  <div class="field"><label>SENHA · MIN 6</label><input id="pass" type="password" placeholder="••••••" autocomplete="current-password"/></div>
  <button class="btn primary" style="width:100%;justify-content:center" id="bIn" onclick="go('login',this)">ENTRAR NO PAINEL</button>
  <button class="btn ghost" style="width:100%;justify-content:center;margin-top:10px" id="bUp" onclick="go('register',this)">CRIAR CONTA PILOTO</button>
  <p id="msg" style="color:#fca5a5;min-height:18px"></p>
  <p style="color:#8f98a0;font-size:12px">Novo por aqui? <a href="/landing">Ver oferta R$ 99/mês</a></p></div>
  <p style="text-align:center;color:#5b6b85;font-size:11px">PRESS START · dados via Steam API oficial</p></div>
  <script>async function go(a,el){var msg=document.getElementById('msg');msg.textContent='';
    var email=document.getElementById('email').value.trim(),pass=document.getElementById('pass').value;
    if(!email||pass.length<6){msg.textContent='Preencha email e senha (min 6).';document.getElementById('lw').classList.add('shake');setTimeout(function(){document.getElementById('lw').classList.remove('shake')},350);return;}
    el.disabled=true;var old=el.textContent;el.textContent='CARREGANDO...';
    try{var r=await fetch('/api/auth/'+a,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:email,pass:pass})}).then(function(x){return x.json()});
    if(r.error){msg.textContent=r.error;el.disabled=false;el.textContent=old;document.getElementById('lw').classList.add('shake');setTimeout(function(){document.getElementById('lw').classList.remove('shake')},350);return;}
    document.getElementById('lw').classList.add('out');setTimeout(function(){location.href='/'},380);}catch(e){msg.textContent='Falha de rede. Tente de novo.';el.disabled=false;el.textContent=old;}}</script>${pxScript}</body></html>`);
});

app.post("/api/auth/register", (req, res) => {
  try {
    const { user, token } = storage.register(String(req.body?.email ?? ""), String(req.body?.pass ?? ""));
    storage.seedDemo(user.id);
    collectSoon(user.id, storage.listGames(user.id).map((g) => g.appId));
    setSession(res, token);
    res.json({ ok: true, email: user.email });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "erro" });
  }
});

app.post("/api/auth/login", (req, res) => {
  try {
    if (throttled(String(req.ip))) return res.status(429).json({ error: "muitas tentativas — aguarde 5 min" });
    const { user, token } = storage.login(String(req.body?.email ?? ""), String(req.body?.pass ?? ""));
    setSession(res, token);
    res.json({ ok: true, email: user.email });
  } catch (e) {
    res.status(401).json({ error: e instanceof Error ? e.message : "erro" });
  }
});

app.post("/api/auth/logout", (req, res) => {
  const token = parseCookies(req.headers?.cookie)[COOKIE];
  if (token) storage.logout(token);
  clearSession(res);
  res.json({ ok: true });
});

app.delete("/api/auth/me", (req, res) => {
  const token = parseCookies(req.headers?.cookie)[COOKIE];
  const me = token ? storage.me(token) : null;
  if (!me) return res.status(401).json({ error: "não logado" });
  storage.deleteUser(me.id);
  clearSession(res);
  res.json({ ok: true });
});

app.get("/api/auth/me", (req, res) => {
  const token = parseCookies(req.headers?.cookie)[COOKIE];
  const me = token ? storage.me(token) : null;
  if (!me) return res.status(401).json({ error: "não logado" });
  res.json({ email: me.email, plan: me.plan, trialLeft: me.trialLeft, pendingPro: me.pendingPro === true });
});

export function buildId(): string {
  return (process.env.RAILWAY_GIT_COMMIT_SHA || "").slice(0, 7) || ("v" + (process.env.npm_package_version || "0.5.0"));
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, build: buildId(), now: new Date().toISOString(), dataDir: process.env.DATA_DIR || "(raiz do app)", steam: "api publica (sem key = proxy por reviews)" });
});

app.get("/api/billing", (req, res) => {
  const uid = uidOf(req);
  if (!uid) return res.status(401).json({ error: "não logado" });
  const token = parseCookies(req.headers?.cookie)[COOKIE];
  const me = storage.me(token!)!;
  const limit = me.plan === "starter" ? 10 : 30;
  res.json({ plan: me.plan, trialLeft: me.trialLeft, pendingPro: me.pendingPro === true, limit, proUntil: me.proUntil ?? null, want: (me.wantPlan || "pro") + "/" + (me.wantPeriod || "monthly") });
});

function planPeriod(req: any): { plan: "starter" | "pro"; period: "monthly" | "annual" } {
  const plan = req.body?.plan === "starter" || req.query?.plan === "starter" ? "starter" : "pro";
  const period = req.body?.period === "annual" || req.query?.period === "annual" ? "annual" : "monthly";
  return { plan, period };
}

app.post("/api/billing/checkout", (req, res) => {
  const uid = uidOf(req);
  if (!uid) return res.status(401).json({ error: "não logado" });
  const { plan, period } = planPeriod(req);
  res.json({ ok: true, plan, period, amount: pixAmount(plan, period), pixKey: pixKey(), pixCode: pixCode(plan, period).code, next: "Pague no app do banco (Pix copia e cola) e clique em JÁ PAGUEI." });
});

app.get("/api/billing/pix", (req, res) => {
  const uid = uidOf(req);
  if (!uid) return res.status(401).json({ error: "não logado" });
  const { plan, period } = planPeriod(req);
  const p = pixCode(plan, period);
  res.json({ plan, period, amount: pixAmount(plan, period), code: p.code, name: p.name });
});

app.post("/api/billing/paid", (req, res) => {
  const uid = uidOf(req);
  if (!uid) return res.status(401).json({ error: "não logado" });
  const { plan, period } = planPeriod(req);
  storage.markPaid(uid, plan, period);
  res.json({ ok: true, status: "pagamento em conferência — liberamos o Pro em até 1 dia útil" });
});

app.get("/api/billing/card", (req, res) => {
  const uid = uidOf(req);
  if (!uid) return res.status(401).json({ error: "não logado" });
  const conf = stripeConf();
  const { plan, period } = planPeriod(req);
  const base = conf.links[`${plan}/${period}`];
  if (!conf.key || !base) return res.json({ configured: false });
  const sep = base.includes("?") ? "&" : "?";
  res.json({ configured: true, url: `${base}${sep}client_reference_id=${encodeURIComponent(`${uid}:${plan}:${period}`)}` });
});

app.post("/api/billing/activate", (req, res) => {
  if ((req.body?.adminKey ?? "") !== (process.env.ADMIN_KEY || "piloto123")) return res.status(403).json({ error: "adminKey inválida" });
  const plan = req.body?.plan === "starter" ? "starter" : "pro";
  const months = req.body?.period === "annual" ? 12 : 1;
  const ok = storage.setPlan(String(req.body?.email ?? ""), plan, months);
  res.json({ ok });
});

app.get("/api/billing/pending", (req, res) => {
  if (String(req.query?.adminKey ?? "") !== (process.env.ADMIN_KEY || "piloto123")) return res.status(403).json({ error: "adminKey inválida" });
  res.json(storage.pendingList());
});

app.get("/api/steamworks", (req, res) => {
  const uid = uidOf(req);
  if (!uid) return res.status(401).json({ error: "não logado" });
  const k = storage.getKey(uid);
  res.json({ configured: Boolean(k), hint: "Cole a Web API Key do grupo financeiro (Steamworks > Users & Permissions > Manage Groups). Sem ela, usamos reviews/players publicos como proxy de velocity." });
});

app.post("/api/steamworks", (req, res) => {
  const uid = uidOf(req);
  if (!uid) return res.status(401).json({ error: "não logado" });
  storage.setKey(U(req), String(req.body?.key ?? ""));
  res.json({ ok: true });
});

app.get("/api/wishlist/:appId", async (req, res) => {
  const uid = uidOf(req);
  if (!uid) return res.status(401).json({ error: "não logado" });
  const key = storage.getKey(uid);
  if (!key) return res.status(501).json({ error: "Steamworks key não configurada — velocity via reviews como proxy", configured: false });
  try {
    const r = await fetch(`https://partner.steampowered.com/api/v1/app/${req.params.appId}/wishlist?key=${encodeURIComponent(key)}`);
    if (!r.ok) return res.status(502).json({ error: `Steamworks respondeu ${r.status} — confira a key e as permissoes do grupo financeiro` });
    res.json(await r.json());
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : "falha" });
  }
});

function needAuth(req: any, res: any, next: any): void {
  const open = ["/landing", "/login", "/api/auth/register", "/api/auth/login", "/api/billing/activate"];
  if (open.includes(req.path)) return next();
  if (req.path.startsWith("/api/internal/")) return next();
  if (req.path === "/" && !uidOf(req)) return res.redirect("/login");
  if (req.path.startsWith("/api/") && !uidOf(req)) {
    if (req.method === "GET" && (req.path === "/api/export.csv" || req.path === "/api/report.md") && String(req.headers?.accept || "").includes("text/html")) return res.redirect("/login");
    return res.status(401).json({ error: "não logado — abra /login" });
  }
  next();
}
app.use(needAuth);

const svg = {
  radar: `<span class="logo87">87</span>`,
  bell: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>`,
  tag: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/></svg>`,
  chart: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`,
  steam: `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-9.9 11.4l4.2 1.7 1.9-2.8 3.4.8V9.5l-2.6-.7-.4-2.6L12 6a4.5 4.5 0 0 1 0 9H9.7l-1.2 1.9 3.5 1.4A10 10 0 0 0 12 2z"/></svg>`,
  check: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>`,
  ext: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`
};

const pxHead = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Press+Start+2P&family=Inter:wght@400;600;800&display=swap" rel="stylesheet">`;
const pxBody = `<canvas id="pxbg"></canvas><div class="scan"></div><div class="vig"></div>`;
const pxScript = `<script>
(function(){var c=document.getElementById('pxbg');if(!c)return;var x=c.getContext('2d');var W,H;
function rs(){W=c.width=innerWidth;H=c.height=innerHeight;}
rs();addEventListener('resize',rs);
var cols=['#4ade80','#66c0f4','#fbbf24','#e879f9','#3b82f6'];
var P=[],S=[],IN=[];
for(var i=0;i<70;i++)P.push({x:Math.random()*2000,y:Math.random()*1200,s:2,v:.1+Math.random()*.3,o:.2+Math.random()*.5,cl:cols[i%cols.length],tw:Math.random()*6.28});
for(var j=0;j<36;j++)S.push({x:Math.random()*2000,y:Math.random()*1200,s:3+Math.floor(Math.random()*3),v:.3+Math.random()*.5,o:.35+Math.random()*.45,cl:cols[(j+2)%cols.length],tw:Math.random()*6.28});
var invader=['00100000100','00010000100','00111111100','01101110110','11111111111','10111111101','10100000101','00011011000'];
function drawInv(ix,iy,sc,col,al){x.globalAlpha=al;x.fillStyle=col;for(var r=0;r<invader.length;r++){for(var q=0;q<invader[r].length;q++){if(invader[r][q]==='1')x.fillRect(ix+q*sc,iy+r*sc,sc,sc);}}x.globalAlpha=1;}
for(var k=0;k<4;k++)IN.push({x:Math.random()*1600,y:Math.random()*900,vx:.12+Math.random()*.15,sc:3,cl:k%2?'#66c0f4':'#4ade80',al:.10+Math.random()*.08});
var meteors=[];
setInterval(function(){if(document.hidden)return;meteors.push({x:W*.2+Math.random()*W*.8,y:-10,vx:-(2+Math.random()*2),vy:2+Math.random()*2,life:1});},3800);
var t=0,gx=0;
(function loop(){t+=.016;gx+=.15;x.clearRect(0,0,W,H);
x.strokeStyle='rgba(70,95,140,.13)';x.lineWidth=1;
var off=gx%96;
for(var X=-96+off;X<W;X+=96){x.beginPath();x.moveTo(X,0);x.lineTo(X,H);x.stroke();}
for(var Y=0;Y<H;Y+=96){x.beginPath();x.moveTo(0,Y);x.lineTo(W,Y);x.stroke();}
var i,p,a;
for(i=0;i<P.length;i++){p=P[i];p.y-=p.v;if(p.y<-8){p.y=H+8;p.x=Math.random()*W;}
a=p.o*(.55+.45*Math.sin(t*1.6+p.tw));x.globalAlpha=Math.max(.06,a);x.fillStyle=p.cl;x.fillRect(p.x,p.y,p.s,p.s);}
for(i=0;i<S.length;i++){p=S[i];p.y-=p.v;p.x+=Math.sin(t*.6+p.tw)*.15;if(p.y<-10){p.y=H+10;p.x=Math.random()*W;}
a=p.o*(.55+.45*Math.sin(t*2.4+p.tw));x.globalAlpha=Math.max(.08,a);x.fillStyle=p.cl;x.fillRect(p.x,p.y,p.s,p.s);
x.globalAlpha=a*.25;x.fillRect(p.x-p.s,p.y, p.s,p.s);x.fillRect(p.x+2*p.s,p.y,p.s,p.s);}
for(i=0;i<IN.length;i++){var n=IN[i];n.x+=n.vx;if(n.x>W+60)n.x=-80;drawInv(n.x,n.y+Math.sin(t*.8+i*2)*10,n.sc,n.cl,n.al);}
for(i=meteors.length-1;i>=0;i--){var m=meteors[i];m.x+=m.vx;m.y+=m.vy;m.life-=.012;
if(m.life<=0||m.y>H+20){meteors.splice(i,1);continue;}
x.globalAlpha=Math.max(0,m.life)*.8;x.fillStyle='#4ade80';
for(var sgm=0;sgm<7;sgm++){x.globalAlpha=Math.max(0,m.life)*(.8-sgm*.11);x.fillRect(m.x-sgm*m.vx*2,m.y-sgm*m.vy*2,3,3);}}
x.globalAlpha=1;requestAnimationFrame(loop);})();
var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target);}})},{threshold:.12});
document.querySelectorAll('.rv').forEach(function(el){io.observe(el);});
})();
function pxFilter(m,el){var bar=el.parentElement;bar.querySelectorAll('.chip').forEach(function(c){c.classList.remove('on')});el.classList.add('on');return m;}</script>`;
const css = `
*{box-sizing:border-box}
:root{--bg:#0a0e1a;--panel:#121828;--panel2:#0d1322;--line:#26324a;--txt:#dbe4f3;--mut:#8f9bb3;--neon:#4ade80;--amber:#fbbf24;--red:#f87171;--blue:#66c0f4;--mag:#e879f9}
html{scroll-behavior:smooth}
body{font-family:'Inter','Segoe UI',system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--txt);margin:0;font-size:14px;overflow-x:hidden}
.px{font-family:'Press Start 2P',monospace}
a{color:var(--blue);text-decoration:none}
#pxbg{position:fixed;inset:0;z-index:0;opacity:.9;pointer-events:none}
.scan{position:fixed;inset:0;z-index:1;pointer-events:none;background:repeating-linear-gradient(0deg,rgba(255,255,255,.022) 0 1px,transparent 1px 3px)}
.vig{position:fixed;inset:0;z-index:1;pointer-events:none;background:radial-gradient(ellipse at 50% -10%,rgba(102,192,244,.10),transparent 55%),radial-gradient(ellipse at 50% 110%,rgba(74,222,128,.07),transparent 55%)}
.wrap{max-width:1180px;margin:0 auto;padding:0 20px 60px;position:relative;z-index:2}
.topbar{background:rgba(8,11,20,.9);border-bottom:3px solid #1b2740;padding:10px 0;font-size:12px;color:var(--mut);position:relative;z-index:2}
.topbar .wrap{display:flex;gap:16px;align-items:center;padding-top:0;padding-bottom:0}
.nav{display:flex;align-items:center;gap:12px;padding:18px 0}
.logo{width:42px;height:42px;background:#0d1526;display:flex;align-items:center;justify-content:center;border:3px solid #33415e;box-shadow:4px 4px 0 #000;image-rendering:pixelated}
.logo svg{image-rendering:pixelated}
.logo87{font-family:'Press Start 2P',monospace;font-size:14px;color:var(--neon);text-shadow:2px 2px 0 #000;letter-spacing:1px}
.loginwrap .logo87{font-size:19px}
.px-title{font-family:'Press Start 2P',monospace;font-size:15px;letter-spacing:.5px}
.px-title .cursor{display:inline-block;width:9px;height:15px;background:var(--neon);vertical-align:-2px;animation:blink 1.1s steps(2) infinite}
@keyframes blink{50%{opacity:0}}
.live{display:inline-flex;align-items:center;gap:7px;font-size:11px;color:#7ee2a8;background:#0c1a12;border:3px solid #1d3a26;padding:5px 10px;box-shadow:3px 3px 0 #000}
.dot{width:8px;height:8px;background:var(--neon);animation:pulse 1.8s infinite}
.dot.pxblink{animation:blink 1s steps(2) infinite}
@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(74,222,128,.55)}70%{box-shadow:0 0 0 9px rgba(74,222,128,0)}100%{box-shadow:0 0 0 0 rgba(74,222,128,0)}}
@keyframes rise{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}
@keyframes floaty{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
@keyframes grow{from{width:0}}
@keyframes marquee{from{transform:translateX(0)}to{transform:translateX(-50%)}}
@keyframes scanmove{from{background-position:0 0}to{background-position:0 120px}}
.rise{animation:rise .55s cubic-bezier(.2,.7,.3,1) both}
.rv{opacity:0;transform:translateY(22px);transition:opacity .6s ease,transform .6s cubic-bezier(.2,.7,.3,1)}
.rv.in{opacity:1;transform:none}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:14px;margin:20px 0}
.kpi{background:var(--panel);border:3px solid var(--line);padding:16px 18px;position:relative;overflow:hidden;box-shadow:5px 5px 0 #000;transition:transform .18s}
.kpi:hover{transform:translate(-2px,-2px);box-shadow:7px 7px 0 #000}
.kpi::after{content:"";position:absolute;left:0;top:0;bottom:0;width:4px;background:var(--blue)}
.kpi.green::after{background:var(--neon)}.kpi.amber::after{background:var(--amber)}.kpi.red::after{background:var(--red)}
.kpi b{font-size:28px;display:block;letter-spacing:-.5px}
.kpi span{font-size:11px;color:var(--mut);text-transform:uppercase;letter-spacing:1px}
.kpi small{color:var(--mut);font-size:12px}
.toolbar{display:flex;gap:10px;flex-wrap:wrap;margin:14px 0;align-items:center}
.tabs{display:flex;gap:0;border:3px solid var(--line);background:#0c1220;width:max-content;max-width:100%;box-shadow:4px 4px 0 #000}
.chip{background:transparent;border:0;border-right:3px solid var(--line);color:#c7d5e0;padding:10px 18px;cursor:pointer;font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;transition:background .15s,color .15s;font-family:inherit}
.chip:last-child{border-right:0}
.chip:hover{background:#182236}
.chip.on{background:var(--neon);color:#06130b;box-shadow:inset 0 -4px 0 rgba(0,0,0,.25)}
.toolbar .chip{background:#0d1526;border:3px solid #2a3a55;padding:10px 14px;box-shadow:4px 4px 0 #000}
.toolbar .chip:hover{border-color:var(--neon)}
.toolbar .chip.on{background:var(--neon);color:#06130b;border-color:#000}
.toolbar .chip:active{transform:translate(2px,2px);box-shadow:1px 1px 0 #000}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(350px,1fr));gap:18px;transition:opacity .25s}
.grid.fading{opacity:.25}
.card{background:var(--panel);border:3px solid var(--line);overflow:hidden;transition:transform .2s ease,border-color .2s,box-shadow .2s;box-shadow:5px 5px 0 #000}
.card:hover{transform:translate(-2px,-4px);border-color:var(--neon);box-shadow:7px 9px 0 #000,0 0 24px rgba(74,222,128,.15)}
.coverwrap{position:relative;background:#05080f;border-bottom:3px solid var(--line)}
img.cover{width:100%;height:158px;object-fit:cover;display:block}
.statusline{position:absolute;left:12px;bottom:10px;display:flex;gap:6px}
.pill{font-size:10px;font-weight:800;letter-spacing:1px;padding:5px 10px;background:rgba(8,12,22,.92);border:2px solid #3a4f63;color:#dbe4f3}
.pill.mine{background:#14280e;border-color:var(--neon);color:#d9f99d}
.pill.off{background:#2e1a12;border-color:var(--amber);color:#fed7aa;animation:floaty 3s ease-in-out infinite}
.pad{padding:16px 18px 18px}
.meta{color:var(--mut);font-size:12px;display:flex;gap:10px;align-items:center;margin-top:4px;flex-wrap:wrap}
.bar{height:8px;background:#05080f;border:2px solid #1c2740;margin-top:8px}
.bar i{display:block;height:100%;background:linear-gradient(90deg,var(--blue),var(--neon));animation:grow 1.1s ease both}
.btn{background:#c7d5e0;color:#10141b;border:0;border:3px solid #000;padding:10px 18px;font-weight:800;cursor:pointer;display:inline-flex;gap:8px;align-items:center;transition:transform .08s;box-shadow:4px 4px 0 #000;font-size:13px;letter-spacing:.4px}
.btn:hover{filter:brightness(1.06)}
.btn:active{transform:translate(3px,3px);box-shadow:1px 1px 0 #000}
.btn.ghost{background:#0d1526;border:3px solid #2a3a55;color:#c7d5e0;box-shadow:4px 4px 0 #000}
.btn.ghost:active{transform:translate(3px,3px);box-shadow:1px 1px 0 #000}
.btn.small{padding:7px 12px;font-size:12px}
.btn.primary{background:var(--neon);border-color:#000;color:#06130b}
input{background:#05080f;border:3px solid #2a3a55;color:#e8eaf2;padding:10px 12px}
input:focus{outline:none;border-color:var(--neon)}
table{width:100%;border-collapse:collapse;font-size:13px;background:var(--panel);border:3px solid var(--line);box-shadow:5px 5px 0 #000}
th{font-size:10px;text-transform:uppercase;letter-spacing:1.2px;color:var(--mut);background:#0c1322;font-family:'Press Start 2P',monospace;font-size:8px}
th,td{padding:11px 13px;border-bottom:1px solid #1c2740;text-align:left}
tr{transition:background .15s}
tbody tr:hover{background:#16203a}
.alert{background:#101828;border:3px solid var(--line);border-left:6px solid var(--blue);padding:12px 14px;margin:8px 0;display:flex;gap:12px;align-items:flex-start;animation:rise .4s ease both;box-shadow:4px 4px 0 #000}
.alert.bomb{border-left-color:var(--red)}.alert.price{border-left-color:var(--amber)}.alert.ok{border-left-color:var(--neon)}
.sev{font-size:9px;font-weight:800;letter-spacing:1px;padding:4px 8px;background:#232d3d;font-family:'Press Start 2P',monospace;font-size:7px}
.sev.crit{background:#3a1414;color:#fca5a5}.sev.warn{background:#3a2a10;color:#fcd34d}.sev.info{background:#12283a;color:#93c5fd}
.sectionhead{display:flex;align-items:center;gap:12px;margin:34px 0 12px}
.pxnum{font-family:'Press Start 2P',monospace;font-size:10px;background:var(--neon);color:#000 !important;font-weight:700;padding:8px 10px;box-shadow:3px 3px 0 #000}
.sectionhead h2{margin:0;font-size:18px}
.sectionhead span{color:var(--mut);font-size:12px}
.legend{display:flex;gap:14px;font-size:12px;color:var(--mut);margin:6px 0 0;flex-wrap:wrap}
.footer{margin-top:44px;padding-top:18px;border-top:3px solid #1b2740;color:var(--mut);font-size:12px;display:flex;gap:16px;flex-wrap:wrap}
#toasts{position:fixed;right:18px;bottom:18px;z-index:60;display:flex;flex-direction:column;gap:10px;max-width:min(380px,90vw)}
.toast{background:#0d1526;border:3px solid var(--line);border-left:6px solid var(--blue);padding:12px 14px;box-shadow:5px 5px 0 #000;font-size:13px;animation:rise .25s ease both}
.toast.ok{border-left-color:var(--neon)}.toast.err{border-left-color:var(--red)}.toast.warn{border-left-color:var(--amber)}
.toast.out{opacity:0;transform:translateX(24px);transition:all .3s}
.discord{background:#1e1f22;border:3px solid #111;box-shadow:6px 6px 0 #000;padding:16px;max-width:560px}
.msg{background:#2b2d31;padding:12px;margin-top:10px;animation:rise .5s ease both;border:2px solid #111}
.embed{border-left:4px solid #5865f2;background:#232428;padding:12px;margin-top:8px}
.hero{display:grid;grid-template-columns:1.05fr .95fr;gap:26px;align-items:start;margin-top:22px}
@media(max-width:900px){.hero{grid-template-columns:1fr}}
.steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin:20px 0}
.step{background:var(--panel);border:3px solid var(--line);padding:18px;box-shadow:5px 5px 0 #000;transition:transform .18s}
.step:hover{transform:translate(-2px,-2px)}
.step b.num{display:inline-flex;width:30px;height:30px;background:var(--neon);color:#000 !important;font-weight:700;align-items:center;justify-content:center;font-family:'Press Start 2P',monospace;font-size:10px;box-shadow:3px 3px 0 #000}
.step.hot{background:#0e1a12;border-color:var(--neon)}
.step.hot span{color:#d9f99d !important}
.step.hot b{color:#fff}
.ticker{border-top:3px solid #1b2740;border-bottom:3px solid #1b2740;background:#0c1322;overflow:hidden;white-space:nowrap;position:relative;z-index:2}
.ticker .track{display:inline-block;padding:10px 0;animation:marquee 30s linear infinite;font-family:'Press Start 2P',monospace;font-size:9px;color:var(--neon);letter-spacing:1px}
.ticker .track b{color:var(--amber)}
.h1px{font-family:'Press Start 2P',monospace;font-size:clamp(18px,3.4vw,34px);line-height:1.5;letter-spacing:0}
.h1px .hl{color:var(--neon)}
.insert{color:var(--amber);font-size:11px;letter-spacing:2px;animation:blink 1.2s steps(2) infinite;font-family:'Press Start 2P',monospace;font-size:8px}
`;

function velocity(u: string, appId: string): number {
  const h = storage.historyFor(u, appId, 8);
  if (h.length < 2) return 0;
  const d = h[h.length - 1].totalReviews - h[0].totalReviews;
  return Math.round((d / Math.max(1, h.length - 1)) * 10) / 10;
}

function sevFor(kind: string): string {
  if (kind === "review-bomb") return `<span class="sev crit">CRITICO</span>`;
  if (kind === "price" || kind === "rating") return `<span class="sev warn">ATENÇÃO</span>`;
  return `<span class="sev info">INFO</span>`;
}

function iconFor(kind: string): string {
  if (kind === "review-bomb") return svg.bell;
  if (kind === "price") return svg.tag;
  return svg.chart;
}

function cardHtml(u: string, g: any, i: number): string {
  const s = storage.lastSnapshot(u, g.appId);
  const vel = velocity(u, g.appId);
  const pos = s?.positivePct ?? 0;
  return `<div class="card rise" style="animation-delay:${Math.min(i * 80, 400)}ms" data-mine="${g.mine ? 1 : 0}">
    <div class="coverwrap">
      <img class="cover" src="${s?.capsule ?? `https://cdn.cloudflare.steamstatic.com/steam/apps/${g.appId}/header.jpg`}" loading="lazy" alt="${g.label || s?.name || g.appId}"/>
      <div class="statusline">
        <span class="pill ${g.mine ? "mine" : ""}">${g.mine ? "PORTFOLIO" : "CONCORRENTE"}</span>
        ${s?.discountPct ? `<span class="pill off">-${s.discountPct}% HOJE</span>` : ""}
      </div>
    </div>
    <div class="pad">
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:baseline">
        <b style="font-size:16px">${g.label || s?.name || g.appId}</b>
        <span style="font-size:12px;color:#8f98a0">App ${g.appId}</span>
      </div>
      <div class="meta"><span style="font-size:20px;font-weight:800;color:#fff">${s?.priceBRL != null ? `R$ ${s.priceBRL.toFixed(2)}` : "A anunciar"}</span>
      <span>${s?.totalReviews ?? 0} reviews</span><span>${s?.ccu ?? 0} online</span></div>
      <div class="meta"><span>Aprovação ${pos}%</span><span style="margin-left:auto">Vel. ${vel}/dia</span></div>
      <div class="bar"><i style="width:${pos}%"></i></div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px">
        <a href="https://store.steampowered.com/app/${g.appId}" target="_blank" rel="noopener">Abrir na Steam ${svg.ext}</a>
        <span style="display:flex;gap:6px"><button class="btn ghost small" onclick="recheck('${g.appId}',this)">Recheck</button>
        <button class="btn ghost small" onclick="removeGame('${g.appId}',this)">Remover</button></span>
      </div>
      <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">
        <button class="btn ghost small" onclick="showAudit('${g.appId}',this)">Auditoria</button>
        <button class="btn ghost small" onclick="showForecast('${g.appId}',this)">Quanto falta p/ subir nota</button>
        <button class="btn ghost small" onclick="showReply('${g.appId}',this)">Rascunho de resposta</button>
      </div>
      <div id="x-${g.appId}" style="margin-top:8px;font-size:12px;color:#c7d5e0"></div>
    </div>
  </div>`;
}

const webhookOn = Boolean(process.env.DISCORD_WEBHOOK_URL);

app.get("/", (req: any, res: any) => {
  const uid = uidOf(req)!;
  const token = parseCookies(req.headers?.cookie)[COOKIE];
  const me = storage.me(token!)!;
  const whOn = Boolean(storage.getWebhook(uid));
  const games = storage.listGames(uid);
  const alerts = storage.listAlerts(uid).slice(0, 15);
  const totalReviews = games.reduce((a, g) => a + (storage.lastSnapshot(U(req), g.appId)?.totalReviews ?? 0), 0);
  const bombs = alerts.filter((a) => a.kind === "review-bomb").length;
  const promos = games.filter((g) => (storage.lastSnapshot(U(req), g.appId)?.discountPct ?? 0) > 0).length;
  const lastSync = storage.historyFor(U(req), games[0]?.appId ?? "", 1)[0]?.fetchedAt ?? null;
  const planLabel = me.plan === "pro" ? "PRO" : `TRIAL · ${me.trialLeft} dias restantes`;
  const trialDead = me.plan !== "pro" && me.trialLeft <= 0;
  const hasWh = Boolean(storage.getWebhook(uid));
  const hasGames = games.length > 0;
  const hasData = games.some((g) => storage.lastSnapshot(uid, g.appId));
  const step = (done: boolean, txt: string) => `<span class="pill" style="${done ? "border-color:var(--neon);color:#d9f99d" : ""}">${done ? "OK · " : "1 · "}${txt}</span>`;
  const nMine = games.filter((g) => g.mine).length;
  const nFoe = games.length - nMine;
  const rows = games.map((g) => {
    const s = storage.lastSnapshot(U(req), g.appId);
    return `<tr><td><img src="https://cdn.cloudflare.steamstatic.com/steam/apps/${g.appId}/capsule_184x69.jpg" width="120" style="border-radius:6px" loading="lazy" alt="capsule"/></td><td><b>${g.label}</b><br/><span style="color:#8f98a0">App ${g.appId} · ${g.mine ? "Portfolio" : "Concorrente"}</span></td><td>${s?.priceBRL != null ? `R$ ${s.priceBRL.toFixed(2)}` : "—"}</td><td>${s?.discountPct ?? 0}%</td><td>${s?.totalReviews ?? 0}</td><td><div style="min-width:110px"><div style="display:flex;justify-content:space-between;font-size:11px;color:#8f98a0"><span>${s?.positivePct ?? 0}%</span></div><div class="bar"><i style="width:${s?.positivePct ?? 0}%"></i></div></div></td><td>+${velocity(U(req), g.appId)}/dia</td></tr>`;
  }).join("");
  res.send(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Publisher Radar 87 — painel do portfolio</title>
  <style>${css}</style>${pxHead}</head><body>${pxBody}
  <div class="topbar"><div class="wrap"><span>Fonte: Steam Store API + Steam Reviews API (oficial, a cada 6h)</span><span style="margin-left:auto">Webhook Discord: ${whOn ? "conectado" : "pendente"} · ${planLabel} · ${me.email} · build ${buildId()} · <a href="#" onclick="logout();return false">sair</a></span></div></div>
  <div class="wrap">
  <div class="nav"><img src="/logo.png" alt="Publisher Radar 87" style="width:46px;height:46px;object-fit:cover;image-rendering:pixelated;border:3px solid #33415e;box-shadow:4px 4px 0 #000"/><div><span class="px-title">PUBLISHER RADAR 87<span class="cursor"></span></span> <span style="color:#8f98a0">· Trial de 7 dias · dados isolados por conta</span><br/><span class="live"><span class="dot"></span>Coleta ativa · última sincronizacao: ${lastSync ? new Date(lastSync).toLocaleString("pt-BR") : "hoje"}</span></div>
  <span style="margin-left:auto;display:flex;gap:8px"></span><a class="btn ghost" href="/landing">Ver oferta R$ 99</a><button class="btn" onclick="runWorker(this)">${svg.chart} Coletar agora</button></div>
  ${trialDead ? `<div class="alert bomb"><span style="color:#f87171">${svg.bell}</span><span><b> trial expirado.</b> Ative o Pro para continuar coletando. <a href="#conta">Ativar Pro · R$ 99 Pix</a></span></div>` : ""}
  <div class="toolbar" id="onboard">
    ${step(hasGames, "adicionar jogos")}${step(hasData, "rodar 1a coleta")}${step(hasWh, "conectar Discord")}
  </div>
  <div id="toasts"></div>
  <div class="kpis">
    <div class="kpi rise"><b>${games.length}<span style="font-size:14px;color:#8f98a0">/30</span></b><span>Jogos monitorados</span><br/><small>limite do plano Piloto</small></div>
    <div class="kpi rise" style="animation-delay:60ms"><b>${totalReviews.toLocaleString("pt-BR")}</b><span>Reviews somados no portfolio</span><br/><small>base para velocity diária</small></div>
    <div class="kpi amber rise" style="animation-delay:120ms"><b>${promos}</b><span>Em promoção agora</span><br/><small>preço e desconto via Steam BR</small></div>
    <div class="kpi ${bombs ? "red" : "green"} rise" style="animation-delay:180ms"><b>${bombs}</b><span>Alertas críticos (24h)</span><br/><small>3+ negativas ou queda de 2pp</small></div>
  </div>
  <div class="sectionhead rv"><h2>Portfolio e concorrentes</h2><span>${games.length} itens · ordenado por adicionado · capsule e preço reais da Steam</span></div>
  <div class="toolbar" id="filterbar">
    <button class="chip on" onclick="filter(0,this)">Todos (${games.length})</button>
    <button class="chip" onclick="filter(1,this)">Portfolio (${nMine})</button>
    <button class="chip" onclick="filter(2,this)">Concorrentes (${nFoe})</button>
    <span style="flex:1"></span>
    <input id="appid" placeholder="AppID (ex 557040)" style="width:170px"/>
    <input id="lbl" placeholder="Rotulo (ex 99Vidas)" style="width:190px"/>
    <button class="btn" onclick="addGame(this)">+ Adicionar</button>
    <button class="btn ghost" onclick="csv()">Exportar CSV</button>
    <button class="btn ghost" onclick="diag(this)">Diagnostico</button>
  </div>
  <div class="legend"><span>${svg.check} Dados de hoje via API oficial</span><span>${svg.bell} Crítico = review-bomb</span><span>${svg.tag} Atenção = preço/rating</span><span id="showline"></span></div>
  <div id="errbar" style="display:none;background:#3a1414;border:3px solid #f87171;color:#fecaca;padding:10px 14px;margin:10px 0;font-size:12px"></div>
  <div id="diagbox" style="display:none;background:#0c1a12;border:3px solid #4ade80;color:#d9f99d;padding:10px 14px;margin:10px 0;font-size:12px;white-space:pre-wrap"></div>
  <div class="grid" id="grid" style="margin-top:12px">${games.length ? games.map((g, i) => cardHtml(uid, g, i)).join("") : `<div class="card"><div class="pad"><b>Nenhum jogo monitorado ainda.</b><p style="color:#8f98a0">Carregue os 3 jogos demo (99Vidas, Atomic Picnic, Sportia) ou adicione pelo AppID acima.</p><button class="btn primary" onclick="seedDemo(this)">CARREGAR 3 JOGOS DEMO</button></div></div>`}</div>
  <div class="sectionhead rv"><h2>Comparativo do portfolio</h2><span>preço BR, desconto, base de reviews, aprovação e velocity de 7 dias</span></div>
  <table><tr><th>Capsule</th><th>Jogo</th><th>Preço</th><th>Desc.</th><th>Reviews</th><th>Aprovação</th><th>Velocity</th></tr>${rows}</table>
  <div class="sectionhead rv"><h2>Calendário de vendas</h2><span>próximas janelas — agir antes, não depois</span></div>
  <table><tr><th>Evento</th><th>Data</th><th>Contagem</th><th>O que o Radar faz</th></tr>
  <tr><td><b>Steam Next Fest · Out 2026</b></td><td>19–26 out 2026</td><td id="cd1">—</td><td>Auditoria da página + velocity diária da demo</td></tr>
  <tr><td><b>Made in Brazil Sale</b></td><td>13–17 fev (anual)</td><td id="cd2">—</td><td>Relatório por publisher + comparativo de desconto</td></tr>
  <tr><td><b>Steam Winter Sale</b></td><td>dezembro</td><td>—</td><td>Alerta de promo do concorrente na hora</td></tr></table>
  <div class="sectionhead rv" id="conta"><h2>Conta e cobrança</h2><span id="planline">plano e trial</span></div>
  <div class="steps" id="plans">
    <div class="step"><b class="num">S</b><p><b>Starter · R$ 49/mês</b><br/><span style="color:#8f98a0">Até 10 jogos · alertas no Discord · ideal para solo.</span></p><button class="btn ghost small" onclick="showPix('starter','monthly',this)">PIX R$ 49</button> <button class="btn ghost small cardbtn" style="display:none" onclick="payCard('starter','monthly',this)">CARTÃO</button></div>
    <div class="step hot"><b class="num">P</b><p><b>Pro · R$ 99/mês</b><br/><span>Até 30 jogos · tudo do Starter · para publishers.</span></p><button class="btn primary small" onclick="showPix('pro','monthly',this)">PIX R$ 99</button> <button class="btn ghost small cardbtn" style="display:none" onclick="payCard('pro','monthly',this)">CARTÃO</button></div>
    <div class="step"><b class="num">12</b><p><b>Anual · R$ 990/ano</b><br/><span style="color:#8f98a0">Pro por 12 meses · 2 meses grátis.</span></p><button class="btn ghost small" onclick="showPix('pro','annual',this)">PIX R$ 990</button> <button class="btn ghost small cardbtn" style="display:none" onclick="payCard('pro','annual',this)">CARTÃO</button></div>
  </div>
  <div class="toolbar">
    <button class="btn ghost" onclick="plan()">Ver meu plano</button>
    <button class="btn ghost" onclick="checkout()">Ativar Pro (Pix)</button>
    <input id="swkey" placeholder="Steamworks Web API Key (grupo financeiro, opcional)" style="min-width:300px;flex:1"/>
    <button class="btn ghost" onclick="saveKey()">Salvar key</button>
    <button class="btn ghost" onclick="checkWish()">Testar wishlist real</button>
  </div>
  <div id="planbox" style="display:none" class="card"><div class="pad" id="planbody"></div></div>
  <div id="pixbox" style="display:none" class="card rv"><div class="pad">
  <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
    <div><span class="pxnum">CHECKOUT</span><h3 id="pixtitle" style="margin:10px 0 2px">Pro · 30 dias · <span style="color:var(--neon)">R$ 99,00</span></h3>
    <span class="meta" id="pixsub">Pix copia e cola · libera em até 1 dia útil · sem fidelidade</span></div>
    <div id="paysteps" style="display:flex;gap:6px"><span class="pill">1 COPIAR</span><span class="pill">2 PAGAR</span><span class="pill">3 JÁ PAGUEI</span></div>
  </div>
  <div style="display:grid;grid-template-columns:220px 1fr;gap:16px;margin-top:12px;align-items:start" id="pixgrid">
    <div style="background:#fff;padding:10px;border:3px solid #000;box-shadow:4px 4px 0 #000"><img id="pixqr" width="196" height="196" alt="QR Pix" style="display:block;width:100%"/></div>
    <div><p style="color:#8f98a0;font-size:12px;margin:0 0 6px">PASSO 1 — COPIE O CÓDIGO NO APP DO BANCO (OU LEIA O QR)</p>
    <textarea id="pixcode" rows="4" readonly style="width:100%;background:#05080f;color:#d9f99d;border:3px solid #2a3a55;font-size:11px"></textarea>
    <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap"><button class="btn ghost small" onclick="copyPix()">Copiar código</button>
    <button class="btn primary small" onclick="markPaid(this)">JÁ PAGUEI</button></div>
    <p id="pixstatus" style="font-size:12px"></p></div>
  </div></div></div>
  <div class="sectionhead rv"><h2>Relatório e integracao</h2><span>o que o publisher encaminha no Slack</span></div>
  <div class="toolbar">
    <button class="btn ghost" onclick="window.open('/api/report.md','_blank')">Relatório semanal (Markdown)</button>
    <button class="btn ghost" onclick="csv()">Baixar CSV</button>
    <input id="wh" placeholder="Webhook Discord https://discord.com/api/webhooks/..." style="min-width:300px;flex:1"/>
    <button class="btn" onclick="saveWh()">Salvar webhook</button>
    <button class="btn ghost" onclick="testWh()">Testar alerta</button>
  </div>
  <div class="toolbar">
    <input id="bulk" placeholder="Cole AppIDs ou URLs Steam: 557040 https://store.steampowered.com/app/1903560" style="flex:1;min-width:280px"/>
    <button class="btn ghost" onclick="bulk()">Importar em lote</button>
  </div>
  <div class="sectionhead rv"><h2>Linha do tempo de alertas</h2><span>severidade, jogo e horario · clique para filtrar</span></div>
  <div class="toolbar"><button class="chip on" onclick="afilter('all',this)">Todos</button><button class="chip" onclick="afilter('review-bomb',this)">Críticos</button><button class="chip" onclick="afilter('price',this)">Preço</button><button class="chip" onclick="afilter('rating',this)">Avaliação</button></div>
  <div id="alerts">${alerts.map((a) => `<div class="alert ${a.kind === "review-bomb" ? "bomb" : a.kind === "price" ? "price" : a.kind === "rating" ? "price" : "ok"}" data-k="${a.kind}"><span style="color:#8f98a0">${iconFor(a.kind)}</span><span style="flex:1">${sevFor(a.kind)} <b>${a.text.split(":")[0]}</b>: ${a.text.split(":").slice(1).join(":")}<br/><small style="color:#8f98a0">${new Date(a.at).toLocaleString("pt-BR")} · App ${a.appId} · <a href="https://store.steampowered.com/app/${a.appId}" target="_blank" rel="noopener">abrir na Steam</a></small></span></div>`).join("") || `<div class="card"><div class="pad"><b>Nenhum alerta ainda.</b><p style="color:#8f98a0">Alertas nascem a cada coleta (preço, reviews, review-bomb). Rode a primeira agora.</p><button class="btn primary" onclick="runWorker(this)">COLETAR AGORA</button></div></div>`}</div>
  <div class="sectionhead rv"><h2>Metodologia</h2><span>como calculamos, sem caixa-preta</span></div>
  <table><tr><th>Métrica</th><th>Fonte</th><th>Regra do alerta</th></tr>
  <tr><td>Preço e desconto (BRL)</td><td>store.steampowered.com/api/appdetails (cc=BR)</td><td>qualquer mudança de preço ou de % off</td></tr>
  <tr><td>Reviews e aprovação</td><td>appreviews + query_summary</td><td>+5 reviews no ciclo ou variação de 2pp com 20+ reviews</td></tr>
  <tr><td>Review-bomb</td><td>últimas 20 reviews, timestamp 24h</td><td>3+ negativas em 24h</td></tr>
  <tr><td>Velocity</td><td>histórico local de 8 coletas</td><td>média diária, sem projeção inventada</td></tr></table>
  <div class="footer"><span>Publisher Radar 87 · build 0.6.0</span><span>Imagens e preços: Valve/Steam (uso descritivo)</span><span style="margin-left:auto"><a href="/landing">Oferta</a> · <a href="/api/games">API</a> · <a href="/api/export.csv">CSV</a> · <a href="#" onclick="delme();return false">excluir minha conta</a></span></div>
  <script>
  window.addEventListener('error',function(e){var b=document.getElementById('errbar');if(b){b.style.display='block';b.textContent='ERRO NA PÁGINA: '+(e.message||'desconhecido')+' — tire um print e mande ao suporte.';}});
  function toast(m,k){var w=document.getElementById('toasts');if(!w)return;var t=document.createElement('div');t.className='toast '+(k||'');t.textContent=m;w.appendChild(t);setTimeout(function(){t.classList.add('out');setTimeout(function(){t.remove()},320)},4200);}
  async function diag(el){var box=document.getElementById('diagbox');box.style.display='block';box.textContent='Testando...';var L=[];
    L.push('cookies: '+(document.cookie?'presentes':'AUSENTES (login não vai grudar)')+', fetch: '+(typeof fetch==='function'?'ok':'AUSENTE')+', Chart: '+(typeof Chart==='function'?'ok':'falhou (graficos quebrados, botoes ok)'));
    try{var m=await fetch('/api/auth/me').then(function(x){return x.json().then(function(j){return {s:x.status,j:j};});});L.push('sessao: HTTP '+m.s+' '+(m.j.email||m.j.error||''));}catch(e){L.push('sessao: FALHA DE REDE '+e);}
    try{var g=await fetch('/api/games').then(function(x){return x.json().then(function(j){return {s:x.status,j:j};});});L.push('jogos: HTTP '+g.s+' total='+(Array.isArray(g.j)?g.j.length:JSON.stringify(g.j).slice(0,80)));}catch(e){L.push('jogos: FALHA DE REDE '+e);}
    try{var t0=Date.now();var k=await fetch('/api/check/557040').then(function(x){return x.json().then(function(j){return {s:x.status,j:j};});});L.push('steam: HTTP '+k.s+' em '+(Date.now()-t0)+'ms '+(k.j.name||k.j.error||''));}catch(e){L.push('steam: FALHA DE REDE '+e);}
    box.textContent=L.join(String.fromCharCode(10));}
  function showline(){var cards=document.querySelectorAll('#grid .card');var vis=0;cards.forEach(function(c){if(c.style.display!=='none')vis++;});var el=document.getElementById('showline');if(el)el.textContent='Mostrando '+vis+' de '+cards.length+' jogos';}
  function filter(m,el){var bar=document.getElementById('filterbar');bar.querySelectorAll('.chip').forEach(function(c){c.classList.remove('on')});el.classList.add('on');var g=document.getElementById('grid');g.classList.add('fading');
    setTimeout(function(){document.querySelectorAll('#grid .card').forEach(function(c){var mine=c.getAttribute('data-mine')==='1';c.style.display=(m===0||(m===1&&mine)||(m===2&&!mine))?'':'none';});g.classList.remove('fading');showline();},160);}
  function afilter(k,el){[...el.parentElement.children].forEach(c=>c.classList.remove('on'));el.classList.add('on');
    document.querySelectorAll('#alerts .alert').forEach(a=>{a.style.display=(k==='all'||a.getAttribute('data-k')===k)?'':'none';});}
  async function needLogin(r){if(r.status===401){toast('Sessão expirada. Faça login de novo.','err');setTimeout(function(){location.href='/login'},1400);return true;}return false;}
  async function addGame(el){const appId=document.getElementById('appid').value.trim();const label=document.getElementById('lbl').value.trim();
    if(!appId){toast('Digite o AppID (só números, ex 557040)','warn');return;}if(el){el.textContent='Adicionando...';el.disabled=true;}const r=await fetch('/api/games',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({appId,mine:true,label})});if(await needLogin(r))return;if(!r.ok){const e=await r.json().catch(()=>({}));toast('Falha: '+(e.error||r.status),'err');if(el){el.textContent='+ Adicionar';el.disabled=false;}return;}toast('Jogo adicionado. Coletando dados da Steam...','ok');setTimeout(function(){location.reload()},1400);}
  async function seedDemo(el){if(el){el.textContent='Carregando...';el.disabled=true;}const r=await fetch('/api/games/seed',{method:'POST'});if(await needLogin(r))return;if(!r.ok){toast('Falha ao carregar demo','err');if(el){el.textContent='CARREGAR 3 JOGOS DEMO';el.disabled=false;}return;}toast('Demos carregados. Coletando dados...','ok');setTimeout(function(){location.reload()},1400);}
  async function removeGame(appId,el){if(!confirm('Remover App '+appId+' do monitoramento?'))return;if(el){el.textContent='...';el.disabled=true;}const r=await fetch('/api/games/'+appId,{method:'DELETE'});if(await needLogin(r))return;if(!r.ok){toast('Falha ao remover','err');if(el){el.textContent='Remover';el.disabled=false;}return;}toast('Removido.','ok');setTimeout(function(){location.reload()},900);}
  async function recheck(appId,el){const b=el||event.target;b.textContent='Coletando...';b.disabled=true;try{const r=await fetch('/api/check/'+appId);if(await needLogin(r))return;if(!r.ok){const e=await r.json().catch(()=>({}));b.textContent='Recheck';b.disabled=false;toast('Falha: '+(e.error||r.status),'err');return;}}catch(e){b.textContent='Recheck';b.disabled=false;toast('Falha de rede. Tente de novo.','err');return;}toast('Coleta atualizada.','ok');setTimeout(function(){location.reload()},900);}
  async function runWorker(el){const b=el||event.target;b.textContent='Coletando...';b.disabled=true;try{const r=await fetch('/api/worker',{method:'POST'});if(await needLogin(r))return;const j=await r.json().catch(()=>null);toast(j&&j.result?j.result.join(String.fromCharCode(10)):'Coleta concluída','ok');setTimeout(function(){location.reload()},1800);}catch(e){toast('Falha de rede. Tente de novo.','err');b.textContent='Coletar agora';b.disabled=false;}}
  function csv(){window.location='/api/export.csv';}
  async function logout(){await fetch('/api/auth/logout',{method:'POST'});location.href='/login';}
  async function delme(){if(!confirm('Excluir sua conta e todos os dados?'))return;await fetch('/api/auth/me',{method:'DELETE'});location.href='/login';}
  async function plan(){const r=await fetch('/api/billing').then(x=>x.json());if(r.error){toast(r.error,'err');return;}
    var name=r.plan==='trial'?'TRIAL':(r.plan==='starter'?'STARTER':'PRO');
    var det=r.plan==='trial'?('restam '+r.trialLeft+' dias · limite '+r.limit+' jogos'):((r.proUntil?('válido até '+String(r.proUntil).slice(0,10)):'ativo')+' · limite '+r.limit+' jogos');
    var st=r.pendingPro?'<span class="pill off">PAGAMENTO EM CONFERÊNCIA ('+r.want+')</span>':(r.plan==='trial'?'<span class="pill">TRIAL</span>':'<span class="pill mine">ATIVO</span>');
    var el=document.getElementById('planline');if(el)el.textContent='Plano '+name+' · '+det;
    var box=document.getElementById('planbox');box.style.display='block';
    document.getElementById('planbody').innerHTML='<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><div><b style="font-size:18px">MEU PLANO · '+name+'</b><br/><span style="color:#c7d5e0">'+det+'</span></div><div>'+st+'</div></div>'+(r.plan==='trial'?'<p style="color:#8f98a0;font-size:13px">Suba de plano para manter a coleta após o trial.</p><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn ghost small" data-pp="starter/monthly">STARTER R$ 49</button><button class="btn primary small" data-pp="pro/monthly">PRO R$ 99</button><button class="btn ghost small" data-pp="pro/annual">ANUAL R$ 990</button></div>':'');
    box.scrollIntoView({behavior:'smooth'});
    document.getElementById('planbody').onclick=function(e){var b=e.target.closest('[data-pp]');if(!b)return;var p=b.getAttribute('data-pp').split('/');showPix(p[0],p[1],b);};
    box.scrollIntoView({behavior:'smooth'});}
  async function checkout(){const r=await fetch('/api/billing/checkout',{method:'POST'}).then(x=>x.json());toast((r.next||'ok')+' Chave Pix: '+(r.pixKey||''));}
  var curPlan='pro',curPeriod='monthly';
  async function showPix(plan,period,el){curPlan=plan||'pro';curPeriod=period||'monthly';var box=document.getElementById('pixbox');box.style.display='block';box.scrollIntoView({behavior:'smooth'});var ta=document.getElementById('pixcode');ta.value='Gerando código...';var names={starter:'Starter',pro:'Pro'};var days=curPeriod==='annual'?'12 meses':'30 dias';document.getElementById('pixtitle').innerHTML=(names[curPlan]||'Pro')+' · '+days+' · <span style="color:var(--neon)">R$ ...</span>';try{var r=await fetch('/api/billing/pix?plan='+curPlan+'&period='+curPeriod).then(x=>x.json());if(r.error){ta.value=r.error;return;}ta.value=r.code;document.getElementById('pixqr').src='https://api.qrserver.com/v1/create-qr-code/?size=220x220&data='+encodeURIComponent(r.code);var st=document.getElementById('pixstatus');var br=String(r.amount).replace('.',',');st.textContent='R$ '+br+' · '+r.name+' · '+(names[curPlan]||'Pro')+' '+(curPeriod==='annual'?'anual (12 meses)':'mensal (30 dias)')+'.';document.getElementById('pixtitle').innerHTML=(names[curPlan]||'Pro')+' · '+days+' · <span style="color:var(--neon)">R$ '+br+'</span>';}catch(e){ta.value='Falha de rede. Tente de novo.';}}
  function copyPix(){var ta=document.getElementById('pixcode');ta.select();try{navigator.clipboard.writeText(ta.value);}catch(e){document.execCommand('copy');}toast('Código Pix copiado.','ok');}
  async function markPaid(el){el.disabled=true;el.textContent='Enviando...';var r=await fetch('/api/billing/paid',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({plan:curPlan,period:curPeriod})}).then(x=>x.json());document.getElementById('pixstatus').textContent=r.status||'ok';el.textContent='JÁ PAGUEI';el.disabled=false;plan();}
  async function payCard(plan,period,el){if(el){el.textContent='Abrindo...';el.disabled=true;}try{var r=await fetch('/api/billing/card?plan='+plan+'&period='+period).then(x=>x.json());if(!r.configured){toast('Cartão em ativação — use o Pix por enquanto.','warn');if(el){el.textContent='CARTÃO';el.disabled=false;}return;}location.href=r.url;}catch(e){toast('Falha de rede. Tente de novo.','err');if(el){el.textContent='CARTÃO';el.disabled=false;}}}
  (function(){fetch('/api/billing/card?plan=pro&period=monthly').then(function(x){return x.json()}).then(function(r){if(r.configured){document.querySelectorAll('.cardbtn').forEach(function(b){b.style.display='';});}}).catch(function(){});})();
  async function saveKey(){const v=document.getElementById('swkey').value.trim();const r=await fetch('/api/steamworks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:v})});if(await needLogin(r))return;toast('Key salva. Use Testar wishlist real.','ok');}
  async function checkWish(){const g=await fetch('/api/games').then(x=>x.json());const appId=(g[0]&&g[0].appId)||'557040';const r=await fetch('/api/wishlist/'+appId).then(x=>x.json());toast(r.configured===false?'Sem key: usando reviews como proxy.':JSON.stringify(r).slice(0,300),r.configured===false?'warn':'ok');}
  async function showAudit(appId,el){const box=document.getElementById('x-'+appId);box.textContent='Analisando página...';if(el)el.disabled=true;try{const r=await fetch('/api/audit/'+appId).then(x=>x.json());
    if(r.error){box.textContent=r.error;return;}
    box.innerHTML='<b>Auditoria '+r.score+'/100</b> · desc '+r.shortLen+' chars · '+r.shots+' shots · '+r.trailers+' trailer(s)<br/>'+(r.issues.length?r.issues.map(i=>'− '+i).join('<br/>'):'Sem problemas críticos.');}catch(e){box.textContent='Falha de rede. Tente de novo.';}finally{if(el)el.disabled=false;}}
  async function showForecast(appId,el){const box=document.getElementById('x-'+appId);box.textContent='Calculando...';if(el)el.disabled=true;try{const r=await fetch('/api/forecast/'+appId).then(x=>x.json());
    if(r.error){box.textContent=r.error;return;}
    box.innerHTML='<b>'+r.band+'</b>'+(r.next?'<br/>Faltam cerca de <b>'+r.need+'</b> avaliações positivas seguidas para chegar a <b>'+r.next+'</b>.':'<br/>Sem projeção (base pequena ou topo da escala).');}catch(e){box.textContent='Falha de rede. Tente de novo.';}finally{if(el)el.disabled=false;}}
  async function showReply(appId,el){const box=document.getElementById('x-'+appId);box.textContent='Buscando reviews...';if(el)el.disabled=true;try{const r=await fetch('/api/reply/'+appId).then(x=>x.json());
    if(!r.draft){box.textContent='Sem reviews recentes para rascunhar.';return;}
    box.innerHTML='<b>Rascunho PT:</b> '+r.draft.pt+'<br/><br/><b>Draft EN:</b> '+r.draft.en+'<br/><button class="btn ghost small" style="margin-top:6px" onclick="navigator.clipboard.writeText(this.parentElement.innerText);this.textContent=&quot;Copiado&quot;">Copiar</button>';}catch(e){box.textContent='Falha de rede. Tente de novo.';}finally{if(el)el.disabled=false;}}
  async function saveWh(){const v=document.getElementById('wh').value.trim();if(!v){toast('Cole a URL do webhook primeiro.','warn');return;}const r=await fetch('/api/config/webhook',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:v})});if(await needLogin(r))return;toast('Webhook salvo. Use Testar alerta.','ok');}
  async function testWh(){const r=await fetch('/api/discord/test',{method:'POST'}).then(x=>x.json());
    if(r.ok&&!r.simulated){toast('Alerta de teste enviado ao Discord.','ok');}
    else if(r.ok){toast('Sem webhook salvo: registrado apenas no log do servidor.','warn');}
    else{toast('Falha: '+(r.error||'verifique o webhook'),'err');}}
  async function bulk(){const t=document.getElementById('bulk').value;if(!t){toast('Cole ao menos um AppID ou URL','warn');return;}const r=await fetch('/api/games/bulk',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:t})});if(await needLogin(r))return;const j=await r.json().catch(()=>({added:0}));toast(j.added+' jogo(s) adicionado(s). Coletando dados...','ok');setTimeout(function(){location.reload()},1400);}
  function cd(id,iso){const el=document.getElementById(id);if(!el)return;const d=Math.ceil((new Date(iso)-Date.now())/86400000);el.textContent=d>0?('faltam '+d+' dias'):(d===0?'começa hoje':'em andamento ou encerrado');}
  document.querySelectorAll('.kpi b').forEach(function(b){var m=b.textContent.match(/^([\d.]+)/);if(!m)return;var target=parseInt(m[1].replace(/\./g,''),10);if(!target||target<20)return;var t0=performance.now();function fr(t){var p=Math.min(1,(t-t0)/900);var v=Math.round(target*(1-Math.pow(1-p,3)));b.childNodes[0].nodeValue=v.toLocaleString('pt-BR');if(p<1)requestAnimationFrame(fr);}requestAnimationFrame(fr);});
  cd('cd1','2026-10-19T10:00:00-03:00');cd('cd2','2027-02-13T10:00:00-03:00');showline();
  </script>${pxScript}</div></body></html>`);
});

app.get("/landing", (req: any, res: any) => {
  res.send(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Publisher Radar 87 — R$ 99/mês</title><style>${css}</style>${pxHead}</head><body>${pxBody}
  <div class="topbar"><div class="wrap"><span>Monitoramento de portfolio Steam para publishers</span><span style="margin-left:auto">PT-BR · <a href="https://api.whatsapp.com/send/?phone=557391865825&text=Ol%C3%A1%21+Vi+o+Publisher+Radar+87+e+quero+testar+o+piloto+gr%C3%A1tis+de+7+dias+para+os+jogos+da+minha+publisher.&type=phone_number&app_absent=0" target="_blank" rel="noopener">Suporte WhatsApp</a> · Sem fidelidade</span></div></div>
  <div class="ticker"><span class="track">WISHLIST VELOCITY <b>+++</b> REVIEW-BOMB ALERT <b>+++</b> PREÇO EM BRL <b>+++</b> NEXT FEST 19–26 OUT <b>+++</b> MADE IN BRAZIL SALE <b>+++</b> RELATÓRIO SEMANAL <b>+++</b> WISHLIST VELOCITY <b>+++</b> REVIEW-BOMB ALERT <b>+++</b> PREÇO EM BRL <b>+++</b> NEXT FEST 19–26 OUT <b>+++</b>&nbsp;</span></div>
  <div class="wrap">
  <div class="nav"><img src="/logo.png" alt="Publisher Radar 87" style="width:46px;height:46px;object-fit:cover;image-rendering:pixelated;border:3px solid #33415e;box-shadow:4px 4px 0 #000"/><span class="px-title">PUBLISHER RADAR 87<span class="cursor"></span></span><span style="margin-left:auto"></span><a class="btn ghost" href="/login">Entrar</a> <a class="btn primary" href="/">Abrir painel demo</a></div>
  <p class="insert">— INSERT COIN · PARA PUBLISHERS COM 5+ JOGOS NA STEAM —</p>
  <h1 class="h1px">A promo do concorrente<br/>vende o <span class="hl">fim de semana.</span><br/>Você descobre na segunda.</h1>
  <p style="color:#c7d5e0;font-size:17px;max-width:760px">Alerta no Discord a cada 6h com preço em BRL, base de reviews, variação de aprovação e pico de jogadores. Sem planilha, sem painel abandonado.</p>
  <div class="hero">
    <div class="discord"><b># alertas-steam</b> <span class="live"><span class="dot"></span>bot online</span>
      <div class="msg"><b>Radar BOT</b> <small style="color:#8f98a0">hoje as 09:12</small><div class="embed"><b>Atomic Picnic — variação relevante de avaliação</b><br/><span style="color:#c7d5e0">4 negativas em 24h · aprovação 78% para 74% · 564 reviews totais</span><br/><img src="https://cdn.cloudflare.steamstatic.com/steam/apps/1903560/header.jpg" width="100%" style="border-radius:8px;margin-top:8px" alt="Atomic Picnic"/><br/><a href="https://store.steampowered.com/app/1903560">Abrir na Steam</a> <span style="color:#8f98a0">·</span> <a href="/">Ver comparativo</a></div></div>
      <div class="msg"><b>Radar BOT</b> <small style="color:#8f98a0">hoje as 09:14</small><div class="embed"><b>99Vidas — entrada em promoção</b><br/><span style="color:#c7d5e0">R$ 29,99 para <b>R$ 5,99 (-80%)</b> · +12 reviews no dia</span><br/><a href="https://store.steampowered.com/app/557040">Abrir na Steam</a></div></div>
    </div>
    <div>
      <div class="steps" style="margin-top:0">
        <div class="step"><b class="num">S</b><p><b>Starter · R$ 49/mês</b><br/><span>Até 10 jogos · ideal para solo.</span></p></div>
        <div class="step hot"><b class="num">P</b><p><b>Pro · R$ 99/mês</b><br/><span>Até 30 jogos · para publishers.</span></p></div>
        <div class="step"><b class="num">12</b><p><b>Anual · R$ 990/ano</b><br/><span>Pro 12 meses · 2 meses grátis.</span></p></div>
      </div>
      <p style="color:#8f98a0;font-size:13px">Pix ou cartão · cancele quando quiser · piloto de 7 dias sem cartão.</p>
      <div class="step" style="margin-top:12px"><b>Entrega semanal no Discord</b><p style="color:#c7d5e0;font-size:14px;margin:8px 0 0">Velocity diária por jogo · Previsão de nota (faltam X positivas) · Rascunho de resposta PT/EN · Auditoria da página 0-100 · Calendário Next Fest/Sale · Relatório semanal em Markdown/CSV.</p>
      <p style="margin:12px 0 0"><a class="btn" href="mailto:87analytics87@gmail.com?subject=Piloto%207%20dias%20Publisher%20Radar%2087">Solicitar piloto de 7 dias</a> <a class="btn ghost" href="https://api.whatsapp.com/send/?phone=557391865825&text=Ol%C3%A1%21+Vi+o+Publisher+Radar+87+e+quero+testar+o+piloto+gr%C3%A1tis+de+7+dias+para+os+jogos+da+minha+publisher.&type=phone_number&app_absent=0" target="_blank" rel="noopener">Chamar no WhatsApp</a></p>
      <p style="color:#8f98a0;font-size:12px">contato: 87analytics87@gmail.com · Exemplo de piloto: 99Vidas (QUByte), Atomic Picnic (BitCake) e Sportia (Hermit Crab) já monitorados.</p></div>
    </div>
  </div>
  <div class="sectionhead rv"><span class="pxnum">01</span><h2>Como funciona</h2><span>3 passos, 2 minutos</span></div>
  <div class="steps">
    <div class="step rise"><b class="num">1</b><p><b>Conecte o Discord</b><br/><span style="color:#8f98a0">Crie um webhook no canal #alertas-steam e cole na configuração. Nenhum acesso a conta Steam.</span></p></div>
    <div class="step rise" style="animation-delay:80ms"><b class="num">2</b><p><b>Cadastre AppIDs</b><br/><span style="color:#8f98a0">Seus jogos + 5 concorrentes por jogo. Importamos preço, reviews e players na hora.</span></p></div>
    <div class="step rise" style="animation-delay:160ms"><b class="num">3</b><p><b>Receba e aja</b><br/><span style="color:#8f98a0">Alerta com severidade, link direto e comparativo. Histórico completo no painel.</span></p></div>
  </div>
  <div class="sectionhead rv"><span class="pxnum">02</span><h2>Feito para quem publica volume</h2><span>3 exemplos reais já no piloto</span></div>
  <table><tr><th>Jogo</th><th>Publisher</th><th>Uso no piloto</th></tr>
  <tr><td><img src="https://cdn.cloudflare.steamstatic.com/steam/apps/557040/capsule_184x69.jpg" style="border-radius:6px" alt="99Vidas"/></td><td><b>QUByte</b><br/><span style="color:#8f98a0">59 jogos e 40 demos</span></td><td>Acompanhar promoções e erosão de avaliação em catalogo grande</td></tr>
  <tr><td><img src="https://cdn.cloudflare.steamstatic.com/steam/apps/1903560/capsule_184x69.jpg" style="border-radius:6px" alt="Atomic Picnic"/></td><td><b>BitCake</b><br/><span style="color:#8f98a0">Multiplayer + Sale com 1.000 jogos</span></td><td>Medir velocity durante a Made in Brazil Sale e detectar pico pos-patch</td></tr>
  <tr><td><img src="https://cdn.cloudflare.steamstatic.com/steam/apps/3897390/capsule_184x69.jpg" style="border-radius:6px" alt="Sportia"/></td><td><b>Hermit Crab</b><br/><span style="color:#8f98a0">Sportia em pre-lançamento</span></td><td>Baseline de reviews zerado e alerta do primeiro movimento</td></tr></table>
  <div class="sectionhead rv"><span class="pxnum">03</span><h2>Comparativo honesto</h2><span>quando usar cada um</span></div>
  <table><tr><th>Ferramenta</th><th>Preço</th><th>Forte</th><th>Limite para publisher BR</th></tr>
  <tr><td>SteamDB</td><td>Grátis</td><td>Dado bruto exato</td><td>Sem alerta, sem comparativo, exige abrir todo dia</td></tr>
  <tr><td>VG Insights / Sensor Tower</td><td>Enterprise</td><td>Estimativa + console</td><td>Preço sob consulta, em inglês, excesso para 30 jogos</td></tr>
  <tr><td>Wishlist Engine</td><td>US$ 15/mês</td><td>Velocity + audit</td><td>Em inglês, sem review-bomb em PT, sem Sale BR</td></tr>
  <tr><td><b>Publisher Radar 87</b></td><td><b>R$ 99/mês</b></td><td><b>Alerta no Discord em PT</b></td><td>Foco Steam PC; wishlist privada exige chave Steamworks</td></tr></table>
  <div class="sectionhead rv"><h2>Perguntas frequentes</h2></div>
  <p><b>De onde vem o dado?</b><br/><span style="color:#8f98a0">API pública da Steam (appdetails cc=BR, appreviews, players). Coleta a cada 6h, histórico no painel. Wishlist privada só com chave financeira Steamworks do dono — ativamos no piloto se você fornecer.</span></p>
  <p><b>Preciso instalar algo na Steam?</b><br/><span style="color:#8f98a0">Não. Somente AppIDs públicos + webhook do Discord. Nenhuma senha.</span></p>
  <p><b>O que acontece no review-bomb?</b><br/><span style="color:#8f98a0">Alerta CRITICO com as últimas negativas, link direto e rascunho de resposta em PT/EN para o community manager.</span></p>
  <div class="footer"><span>Publisher Radar 87 · Imagens, preços e marcas: Valve/Steam, uso descritivo</span><span style="margin-left:auto"><a href="/">Painel</a> · <a href="/api/export.csv">CSV de exemplo</a></span></div>
  ${pxScript}</div></body></html>`);
});

app.get("/api/games", (req: any, res: any) => res.json(storage.listGames(uidOf(req)!)));

app.post("/api/games", (req: any, res: any) => {
  try {
    const uid = uidOf(req)!;
    const raw = req.body?.appId ?? req.body?.url ?? "";
    const parsed = parseAppId(String(raw)) ?? String(raw).trim();
    const { mine, label } = req.body ?? {};
    if (!parsed) return res.status(400).json({ error: "appId ou URL Steam obrigatório" });
    const g = storage.addGame(U(req), parsed, mine !== false, String(label ?? ""));
    collectSoon(U(req), [g.appId]);
    res.json(g);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "erro" });
  }
});

app.post("/api/games/bulk", (req, res) => {
  const text: string = String(req.body?.text ?? "");
  const ids = [...new Set([...text.matchAll(/(\d{3,10})/g)].map((m) => m[1]))].slice(0, 30);
  const added = [];
  for (const id of ids) {
    try {
      added.push(storage.addGame(U(req), id, true, ""));
    } catch {}
  }
  collectSoon(U(req), added.map((g: any) => g.appId));
  res.json({ added: added.length, ids });
});

app.post("/api/games/seed", (req: any, res: any) => {
  const uid = U(req);
  storage.seedDemo(uid);
  const games = storage.listGames(uid);
  collectSoon(uid, games.map((g) => g.appId));
  res.json({ ok: true, games });
});

app.get("/api/config", (req: any, res: any) => {
  const uid = U(req);
  const wh = storage.getWebhook(uid);
  res.json({ webhook: wh ? "configurado" : "pendente", worker: "a cada 6h", plan: "piloto 30 jogos" });
});

app.post("/api/config/webhook", (req, res) => {
  storage.setWebhook(U(req),String(req.body?.url ?? ""));
  res.json({ ok: true });
});

app.get("/api/audit/:appId", async (req, res) => {
  try {
    const s = storage.lastSnapshot(U(req),req.params.appId) ?? await fetchSnapshot(req.params.appId);
    if (!storage.lastSnapshot(U(req),req.params.appId)) storage.pushSnapshot(U(req),s);
    res.json({ appId: s.appId, name: s.name, score: s.audit, issues: s.auditIssues, shortLen: s.shortLen, shots: s.shots, trailers: s.trailers, url: s.url });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "erro" });
  }
});

app.get("/api/forecast/:appId", (req, res) => {
  const s = storage.lastSnapshot(U(req),req.params.appId);
  if (!s) return res.status(404).json({ error: "sem coleta ainda, rode o recheck" });
  res.json({ appId: s.appId, name: s.name, total: s.totalReviews, pos: s.positivePct, ...scoreForecast(s.totalReviews, s.positivePct) });
});

app.get("/api/reply/:appId", async (req, res) => {
  try {
    const s = storage.lastSnapshot(U(req),req.params.appId);
    const list = await fetchRecentReviews(req.params.appId, 3);
    const neg = list.find((r) => !r.positive) ?? list[0];
    if (!neg) return res.json({ reviews: [], draft: null });
    res.json({ reviews: list, draft: draftReply(s?.name ?? req.params.appId, neg), source: neg });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "erro" });
  }
});

app.get("/api/report.md", (req: any, res: any) => {
  if (!uidOf(req)) {
    if (String(req.headers?.accept || "").includes("text/html")) return res.redirect("/login");
    return res.status(401).json({ error: "não logado — abra /login" });
  }
  const uid = U(req);
  const games = storage.listGames(uid);
  const alerts = storage.listAlerts(uid).slice(0, 20);
  const L: string[] = [`# Publisher Radar 87 — relatório semanal`, ``, `Gerado em ${new Date().toLocaleString("pt-BR")}`, ``, `## Portfolio`];
  for (const g of games) {
    const s = storage.lastSnapshot(U(req),g.appId);
    const f = s ? scoreForecast(s.totalReviews, s.positivePct) : null;
    L.push(``, `### ${g.label || s?.name || g.appId}`, `- Steam: https://store.steampowered.com/app/${g.appId}`, `- Preço: R$ ${s?.priceBRL ?? "—"} (${s?.discountPct ?? 0}% off) · ${s?.totalReviews ?? 0} reviews, ${s?.positivePct ?? 0}% aprovação`, `- Faixa: ${f?.band ?? "—"}${f?.next ? ` · faltam ~${f.need} positivas seguidas para ${f.next}` : ""}`, `- Auditoria da página: ${s?.audit ?? "—"}/100${s?.auditIssues?.[0] ? ` — ${s.auditIssues[0]}` : ""}`);
  }
  L.push(``, `## Alertas recentes`);
  for (const a of alerts) L.push(`- [${a.kind}] ${a.text} (${a.at.slice(0, 10)})`);
  res.setHeader("Content-Type", "text/markdown; charset=utf-8");
  res.send(L.join("\n"));
});

app.delete("/api/games/:appId", (req, res) => {
  const ok = storage.removeGame(U(req), req.params.appId);
  if (!ok) return res.status(404).json({ error: "jogo não estava monitorado" });
  res.json({ ok: true });
});

app.get("/api/check/:appId", async (req, res) => {
  try {
    const requester = U(req);
    if (!storage.trialOk(requester)) return res.status(402).json({ error: "trial expirado — ative o Pro para continuar coletando" });
    const prev = storage.lastSnapshot(requester, req.params.appId);
    const s = await fetchSnapshot(req.params.appId);
    storage.pushSnapshot(requester, s);
    const changes = diffSnapshots(prev, s);
    for (const c of changes) storage.pushAlert(requester, { appId: s.appId, kind: c.kind, text: `${s.name}: ${c.text}` });
    res.json({ ...s, newAlerts: changes.length });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "erro" });
  }
});

app.get("/api/history/:appId", (req, res) => res.json(storage.historyFor(U(req),req.params.appId, 90)));
app.get("/api/alerts", (req: any, res: any) => res.json(storage.listAlerts(U(req))));

app.get("/api/export.csv", (req: any, res: any) => {
  if (!uidOf(req)) {
    if (String(req.headers?.accept || "").includes("text/html")) return res.redirect("/login");
    return res.status(401).json({ error: "não logado — abra /login" });
  }
  const uid = U(req);
  const games = storage.listGames(uid);
  const lines = ["jogo;appid;tipo;preco_brl;desconto_pct;reviews;aprovação_pct;velocity_dia;url_steam"];
  for (const g of games) {
    const s = storage.lastSnapshot(U(req),g.appId);
    const h = storage.historyFor(U(req),g.appId, 8);
    const vel = h.length > 1 ? ((h[h.length - 1].totalReviews - h[0].totalReviews) / Math.max(1, h.length - 1)).toFixed(1) : "0";
    lines.push([`"${g.label || s?.name || g.appId}"`, g.appId, g.mine ? "portfolio" : "concorrente", s?.priceBRL ?? "", s?.discountPct ?? 0, s?.totalReviews ?? 0, s?.positivePct ?? 0, vel, `https://store.steampowered.com/app/${g.appId}`].join(";"));
  }
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.send("\uFEFF" + lines.join("\n"));
});

function internalOk(req: any): boolean {
  const key = String(req.headers["x-internal-key"] || req.query?.key || "");
  const expected = process.env.INTERNAL_KEY || process.env.ADMIN_KEY || "piloto123";
  return key !== "" && key === expected;
}

app.get("/api/internal/users", (req, res) => {
  if (!internalOk(req)) return res.status(403).json({ error: "forbidden" });
  res.json({ users: storage.allUserIds() });
});

app.post("/api/internal/collect", async (req, res) => {
  if (!internalOk(req)) return res.status(403).json({ error: "forbidden" });
  try {
    const userId = String(req.body?.userId || "");
    if (!userId) return res.status(400).json({ error: "userId obrigatorio" });
    const { fetchSnapshot: fsnap, fetchRecentNegatives: fneg } = await import("./steam.js");
    const { sendRadarEmbed: sendE } = await import("./discord.js");
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const out: string[] = [];
    for (const g of storage.listGames(userId)) {
      try {
        const prev = storage.lastSnapshot(userId, g.appId);
        const cur = await fsnap(g.appId);
        storage.pushSnapshot(userId, cur);
        const changes = diffSnapshots(prev, cur);
        try {
          const neg = await fneg(g.appId, 1);
          if (neg >= 3) changes.push({ text: `${neg} avaliações negativas nas últimas 24h`, kind: "review-bomb" });
        } catch {}
        for (const c of changes) storage.pushAlert(userId, { appId: g.appId, kind: c.kind, text: `${cur.name}: ${c.text}` });
        if (changes.length) await sendE(userId, cur, changes.map((c) => c.text));
        out.push(`${cur.name}: ${changes.length ? changes.length + " mudança(s)" : "sem novidades"}`);
      } catch (e) {
        out.push(`${g.appId}: ${e instanceof Error ? e.message : "falha"}`);
      }
      await sleep(1200);
    }
    res.json({ ok: true, result: out });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "falha na coleta" });
  }
});

app.post("/api/worker", async (req: any, res: any) => {
  try {
    const requester = U(req);
    if (!storage.trialOk(requester)) return res.status(402).json({ error: "trial expirado — ative o Pro para continuar coletando" });
    const { fetchSnapshot: fsnap, fetchRecentNegatives: fneg } = await import("./steam.js");
    const { sendRadarEmbed: sendE } = await import("./discord.js");
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const out: string[] = [];
    for (const g of storage.listGames(requester)) {
      try {
        const prev = storage.lastSnapshot(requester, g.appId);
        const cur = await fsnap(g.appId);
        storage.pushSnapshot(requester, cur);
        const changes = diffSnapshots(prev, cur);
        try {
          const neg = await fneg(g.appId, 1);
          if (neg >= 3) changes.push({ text: `${neg} avaliações negativas nas últimas 24h`, kind: "review-bomb" });
        } catch {}
        for (const c of changes) storage.pushAlert(requester, { appId: g.appId, kind: c.kind, text: `${cur.name}: ${c.text}` });
        if (changes.length) await sendE(requester, cur, changes.map((c) => c.text));
        out.push(`${cur.name}: ${changes.length ? changes.length + " mudança(s)" : "sem novidades"}`);
      } catch (e) {
        out.push(`${g.appId}: ${e instanceof Error ? e.message : "falha"}`);
      }
      await sleep(1200);
    }
    res.json({ ok: true, result: out });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "falha na coleta" });
  }
});

app.post("/api/discord/test", async (req: any, res: any) => {
  try {
    const requester = U(req);
    const r = await sendDiscord(requester, "Radar conectado — canal de alertas ativo.\nAtomic Picnic: 4 negativas em 24h (78% para 74%)\n99Vidas: R$ 29,99 para R$ 5,99 (-80%)");
    res.json({ ok: true, simulated: r.simulated });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "erro" });
  }
});

const port = Number(process.env.PORT ?? 3020);
app.listen(port, () => console.log(`Radar em http://localhost:${port}`));
