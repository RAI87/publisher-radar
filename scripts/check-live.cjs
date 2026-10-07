// Valida o JS servido nas 3 paginas (pega a classe de bug que ja matou os botoes 2x).
// Uso: npm run check:live
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const root = path.join(__dirname, "..");
const srv = spawn(process.execPath, [path.join(root, "node_modules", "tsx", "dist", "cli.mjs"), "src/index.ts"], { cwd: root, stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let cookie = "";

async function api(method, url, body) {
  const r = await fetch("http://localhost:3020" + url, {
    method,
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const set = r.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  return r.json();
}

(async () => {
  for (let i = 0; i < 25; i++) {
    try {
      const r = await fetch("http://localhost:3020/landing");
      if (r.ok) break;
    } catch {}
    await sleep(1000);
  }
  await api("POST", "/api/auth/register", { email: "checklive@teste.com", pass: "teste123" });
  let bad = 0;
  for (const page of ["/", "/login", "/landing"]) {
    const html = await fetch("http://localhost:3020" + page, { headers: cookie ? { Cookie: cookie } : {} }).then((r) => r.text());
    const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    blocks.forEach((code, i) => {
      fs.writeFileSync(path.join(root, "blk-tmp.js"), code);
      try {
        execSync("node --check ./blk-tmp.js", { cwd: root, stdio: "pipe" });
      } catch (e) {
        bad++;
        console.log(`FAIL ${page} bloco ${i}:`);
        console.log(((e.stdout || "") + "" + (e.stderr || "")).split("\n").slice(0, 5).join("\n"));
      }
    });
    console.log(`${page}: ${blocks.length} blocos ok`);
  }
  try { fs.unlinkSync(path.join(root, "blk-tmp.js")); } catch {}
  // limpa usuario de teste
  try {
    const fsdb = require("fs");
    const f = path.join(root, "data.json");
    const d = JSON.parse(fsdb.readFileSync(f, "utf8"));
    const u = d.users.find((x) => x.email === "checklive@teste.com");
    if (u) {
      d.users = d.users.filter((x) => x.id !== u.id);
      delete d.data[u.id];
      d.sessions = d.sessions.filter((s) => s.userId !== u.id);
      fsdb.writeFileSync(f, JSON.stringify(d, null, 2));
    }
  } catch {}
  srv.kill();
  setTimeout(() => process.exit(bad ? 1 : 0), 500);
})().catch((e) => { console.log("CHECK LIVE FAIL " + e.message); try { srv.kill(); } catch {} process.exit(1); });
setTimeout(() => { console.log("timeout"); try { srv.kill(); } catch {} process.exit(1); }, 90000).unref();
